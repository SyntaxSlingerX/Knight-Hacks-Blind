"""
Meta Project Aria Live Streaming Bridge for Aria Vision
-------------------------------------------------------
Receives the RGB camera from Meta Project Aria (Gen 1) glasses and re-serves it to the
Aria Vision web app over a WebSocket (ws://<host>:<port>).

What the web app receives on that socket:
  * binary messages  -> one upright JPEG camera frame each
  * text messages    -> JSON, {"type": "status", ...} once a second and, with --slam,
                        {"type": "pose", ...} about ten times a second

Things worth knowing:
  * The glasses decide the frame rate, through the streaming profile. `aria streaming
    profiles` only lists profile12 and profile18 (both 10 fps), but over USB the glasses
    also accept the recording profiles. profile15 sends the RGB camera and both SLAM
    cameras at 30 fps and is the default on USB. Wi-Fi keeps profile18 (10 fps), because
    30 fps of full-size frames is too much for most Wi-Fi links.
  * The bridge heals itself. If no camera frame arrives for a few seconds (cable bumped,
    glasses went to sleep, Wi-Fi dropped) it tears the session down and starts a new one.
    The web app is told through the status messages, so it never shows a frozen picture
    as if it were live.
  * Picture size only affects the bridge -> browser hop. The glasses -> bridge hop always
    carries the full sensor image, so shrinking the picture does not help a weak
    glasses connection. Use USB for the most stable link.

Usage:
    # Glasses over USB (most reliable, 30 fps):
    python aria_bridge.py --mode aria --interface usb

    # Cooler and lighter on the glasses, 10 fps:
    python aria_bridge.py --mode aria --interface usb --profile profile12

    # Glasses over Wi-Fi (glasses and computer on the same network):
    python aria_bridge.py --mode aria --interface wifi --device-ip 10.149.207.241

    # Glasses plus live SLAM (head position and heading):
    python aria_bridge.py --mode aria --interface usb --slam

    # No glasses: computer webcam, or a synthetic test pattern
    python aria_bridge.py --mode webcam
    python aria_bridge.py --mode test

On a Mac, AirPlay Receiver owns port 7000. Run with --port 7001 and set
VITE_ARIA_STREAM_URL="ws://localhost:7001" in .env.
"""

import argparse
import asyncio
import base64
import json
import multiprocessing
import os
import signal
import subprocess
import sys
import threading
import time

import numpy as np
import cv2

# Import aria.sdk first to ensure its native shared libraries and embedded OpenSSL symbols
# are loaded into the process before Python's ssl/websockets modules load system OpenSSL 3.
try:
    import aria.sdk as aria
except ImportError:
    aria = None

import websockets

CONNECTED_CLIENTS = set()
SENDING_CLIENTS = set()
FRAME_QUEUE: asyncio.Queue | None = None

# Skip a frame for a client whose socket still holds more than this many unsent bytes.
# Sized in main() to a few frames at the chosen picture size.
BUFFER_DROP_THRESHOLD = 512 * 1024

# Tell the web app the picture is stale after this long without a camera frame...
STALL_WARN_S = 1.5
# ...and restart the glasses session after this long.
STALL_TIMEOUT_S = 3.0
# A new session gets this long to deliver its first frame (DDS discovery takes a while).
FIRST_FRAME_TIMEOUT_S = 20.0
DEVICE_STATUS_POLL_S = 30.0

# RGB frame rate of the profiles worth using for streaming (measured on Gen 1 glasses over USB).
PROFILE_RGB_FPS = {"profile12": 10, "profile18": 10, "profile2": 20, "profile15": 30, "profile22": 30}
DEFAULT_PROFILE = {"usb": "profile15", "wifi": "profile18"}

# Seconds to wait before each new attempt when the glasses fail to start streaming.
# Short first (they may only have been switching modes), then patient: after several quick
# restarts the glasses refuse new sessions for about a minute, and hammering does not help.
START_RETRY_WAITS_S = (5.0, 20.0, 40.0, 60.0)


class BridgeStats:
    """Live counters shared by the camera threads, the sender, and the status reporter."""

    def __init__(self):
        self.source = "test"
        self.interface = None
        self.profile = None
        self.state = "starting"  # starting | connecting | streaming | stalled | reconnecting | error
        self.detail = ""
        self.rx_frames = 0  # frames received from the camera source
        self.tx_frames = 0  # frames written to browsers
        self.tx_bytes = 0
        self.dropped = 0  # frames skipped because a browser was still busy with the previous one
        self.last_rx = None  # time.monotonic() of the newest source frame
        self.frame_age_ms = 0.0  # time a frame spent inside the bridge before it was sent
        self.width = 0
        self.height = 0
        self.rx_fps = 0.0
        self.rx_fps_from_worker = False  # aria mode: the glasses worker measures the camera rate
        self.tx_fps = 0.0
        self.restarts = 0
        self.worker_restarts = 0
        self.battery = None
        self.thermal = None
        self.skin_temp_c = None
        self.slam = "off"  # off | starting | tracking | lost | stopped

    def set_state(self, state: str, detail: str = ""):
        self.state = state
        self.detail = detail

    def mark_source_frame(self):
        self.rx_frames += 1
        self.last_rx = time.monotonic()

    def as_message(self) -> str:
        return json.dumps(
            {
                "type": "status",
                "source": self.source,
                "interface": self.interface,
                "profile": self.profile,
                "state": self.state,
                "detail": self.detail,
                "rxFps": round(self.rx_fps, 1),
                "txFps": round(self.tx_fps, 1),
                "frameAgeMs": round(self.frame_age_ms, 1),
                "width": self.width,
                "height": self.height,
                "restarts": self.restarts,
                "battery": self.battery,
                "thermal": self.thermal,
                "skinTempC": self.skin_temp_c,
                "slam": self.slam,
            }
        )


STATS = BridgeStats()


def log(message: str):
    """Prints an event on its own line with a wall-clock time, clear of the live status line."""
    print(f"\n[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def keep_computer_awake() -> bool:
    """
    Stops the computer from going to sleep on idle while the bridge runs. A sleeping computer
    drops its link to the glasses, which is an easy way to lose the stream mid-demo.
    Closing a laptop lid still puts it to sleep.
    """
    try:
        if sys.platform == "darwin":
            # caffeinate exits by itself when this process does (-w).
            subprocess.Popen(
                ["caffeinate", "-i", "-w", str(os.getpid())],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return True
        if sys.platform == "win32":
            import ctypes

            es_continuous, es_system_required = 0x80000000, 0x00000001
            ctypes.windll.kernel32.SetThreadExecutionState(es_continuous | es_system_required)
            return True
    except Exception:
        pass
    return False


def encode_jpeg(bgr: np.ndarray, quality: int, as_base64: bool):
    """Encodes a BGR image as a JPEG payload (raw bytes, or a base64 data URL)."""
    _, buffer = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    raw_bytes = buffer.tobytes()
    STATS.height, STATS.width = bgr.shape[:2]
    if as_base64:
        return f"data:image/jpeg;base64,{base64.b64encode(raw_bytes).decode('utf-8')}"
    return raw_bytes


def process_aria_rgb_frame(raw_img: np.ndarray, max_dim: int = 768, quality: int = 80, as_base64: bool = False):
    """
    Turns a raw Aria RGB camera image into an upright JPEG payload.
    1. Downscales so the longest side is max_dim.
    2. Converts RGB -> BGR for OpenCV encoding.
    3. Rotates 90 degrees clockwise (the Aria sensor is mounted sideways).
    4. Encodes as JPEG.
    """
    h, w = raw_img.shape[:2]
    if max_dim > 0 and (w > max_dim or h > max_dim):
        scale = float(max_dim) / max(w, h)
        new_w, new_h = max(1, int(w * scale)), max(1, int(h * scale))
        raw_img = cv2.resize(raw_img, (new_w, new_h), interpolation=cv2.INTER_AREA)

    if len(raw_img.shape) == 3 and raw_img.shape[2] == 3:
        bgr = cv2.cvtColor(raw_img, cv2.COLOR_RGB2BGR)
    else:
        bgr = raw_img

    upright = cv2.rotate(bgr, cv2.ROTATE_90_CLOCKWISE)
    return encode_jpeg(upright, quality, as_base64)


def enqueue_frame_threadsafe(payload, t_arrival: float):
    """Puts a frame in the single-slot queue, replacing any frame that was not sent yet."""
    if FRAME_QUEUE is None or not CONNECTED_CLIENTS:
        return
    try:
        if FRAME_QUEUE.full():
            FRAME_QUEUE.get_nowait()
        FRAME_QUEUE.put_nowait((payload, t_arrival))
    except Exception:
        pass


async def send_text_to_client(client, text: str):
    try:
        await client.send(text)
    except Exception:
        pass


def broadcast_text(text: str):
    """Sends a small JSON message to every browser. Must be called on the event loop."""
    for client in list(CONNECTED_CLIENTS):
        asyncio.create_task(send_text_to_client(client, text))


async def register_client(websocket):
    """Tracks connected clients and disables Nagle's algorithm for minimum jitter."""
    try:
        transport = getattr(websocket, "transport", None)
        if transport is not None:
            sock = transport.get_extra_info("socket")
            if sock is not None:
                import socket as _sys_socket

                sock.setsockopt(_sys_socket.IPPROTO_TCP, _sys_socket.TCP_NODELAY, 1)
    except Exception:
        pass

    CONNECTED_CLIENTS.add(websocket)
    remote = getattr(websocket, "remote_address", "client")
    print(f"\n[+] Client connected from {remote}. Total clients: {len(CONNECTED_CLIENTS)}")
    # Tell a new browser straight away whether the camera is live.
    await send_text_to_client(websocket, STATS.as_message())
    try:
        await websocket.wait_closed()
    finally:
        CONNECTED_CLIENTS.discard(websocket)
        SENDING_CLIENTS.discard(websocket)
        print(f"\n[-] Client disconnected from {remote}. Remaining clients: {len(CONNECTED_CLIENTS)}")


async def send_frame_to_client(client, payload, t_arrival: float):
    """Sends one frame to one client without blocking the dispatcher."""
    SENDING_CLIENTS.add(client)
    try:
        await client.send(payload)
        STATS.tx_frames += 1
        STATS.tx_bytes += len(payload)
        STATS.frame_age_ms = (time.monotonic() - t_arrival) * 1000.0
    except Exception:
        pass
    finally:
        SENDING_CLIENTS.discard(client)


async def broadcast_frame(payload, t_arrival: float):
    """
    Sends a frame to every client. A client that is still busy with the previous frame
    skips this one, so a slow browser falls behind in frame rate, never in time.
    """
    for client in list(CONNECTED_CLIENTS):
        if client in SENDING_CLIENTS:
            STATS.dropped += 1
            continue
        transport = getattr(client, "transport", None)
        if transport is not None and hasattr(transport, "get_write_buffer_size"):
            if transport.get_write_buffer_size() > BUFFER_DROP_THRESHOLD:
                STATS.dropped += 1
                continue
        asyncio.create_task(send_frame_to_client(client, payload, t_arrival))


async def frame_dispatcher():
    """Continuously sends the freshest frame from the single-slot queue."""
    while True:
        payload, t_arrival = await FRAME_QUEUE.get()
        await broadcast_frame(payload, t_arrival)


async def telemetry_reporter():
    """Once a second: work out the live rates, print them, and send them to the browsers."""
    last_time = time.perf_counter()
    last_rx = 0
    last_tx = 0
    last_bytes = 0

    while True:
        await asyncio.sleep(1.0)
        now = time.perf_counter()
        elapsed = now - last_time
        if elapsed <= 0:
            continue

        rx_delta = STATS.rx_frames - last_rx
        tx_delta = STATS.tx_frames - last_tx
        bytes_delta = STATS.tx_bytes - last_bytes
        last_time = now
        last_rx = STATS.rx_frames
        last_tx = STATS.tx_frames
        last_bytes = STATS.tx_bytes

        if not STATS.rx_fps_from_worker:
            STATS.rx_fps = rx_delta / elapsed
        # tx counts one per client per frame, so divide to get the per-browser rate.
        STATS.tx_fps = (tx_delta / elapsed) / max(1, len(CONNECTED_CLIENTS))
        avg_kb = (bytes_delta / 1024.0 / tx_delta) if tx_delta > 0 else 0.0

        line = (
            f"[*] {STATS.state:<12} camera {STATS.rx_fps:4.1f} fps | to browser {STATS.tx_fps:4.1f} fps | "
            f"{avg_kb:5.1f} KB/frame | {STATS.frame_age_ms:4.0f} ms in bridge | "
            f"{len(CONNECTED_CLIENTS)} client(s)"
        )
        if STATS.slam != "off":
            line += f" | slam {STATS.slam}"
        if STATS.restarts:
            line += f" | restarts {STATS.restarts}"
        print("\r" + line.ljust(118), end="", flush=True)

        if CONNECTED_CLIENTS:
            broadcast_text(STATS.as_message())


# ---------------------------------------------------------------------------
# Webcam and test-pattern sources (no glasses needed)
# ---------------------------------------------------------------------------


def webcam_capture_thread(
    camera_id: int,
    max_dim: int,
    quality: int,
    as_base64: bool,
    target_fps: int,
    stop_event: threading.Event,
    loop: asyncio.AbstractEventLoop,
):
    print(f"[*] Starting camera capture thread on device index {camera_id}...")
    cap = cv2.VideoCapture(camera_id)
    if not cap.isOpened():
        print(f"[!] Warning: Cannot open camera {camera_id}. Switching to test pattern.")
        stop_event.set()
        return

    STATS.set_state("streaming")
    last_capture = 0.0
    try:
        while not stop_event.is_set():
            now = time.perf_counter()
            if target_fps > 0 and (now - last_capture) < (0.92 / target_fps):
                time.sleep(0.001)
                continue

            ret, frame = cap.read()
            if not ret:
                time.sleep(0.01)
                continue
            last_capture = time.perf_counter()
            t_arrival = time.monotonic()
            STATS.mark_source_frame()

            if not CONNECTED_CLIENTS:
                time.sleep(0.05)
                continue

            h, w = frame.shape[:2]
            if max_dim > 0 and (w > max_dim or h > max_dim):
                scale = float(max_dim) / max(w, h)
                new_w, new_h = max(1, int(w * scale)), max(1, int(h * scale))
                frame = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)

            payload = encode_jpeg(frame, quality, as_base64)
            loop.call_soon_threadsafe(enqueue_frame_threadsafe, payload, t_arrival)
    finally:
        cap.release()


async def run_webcam_capture(
    camera_id: int = 0,
    max_dim: int = 768,
    quality: int = 80,
    as_base64: bool = False,
    target_fps: int = 30,
):
    current_loop = asyncio.get_running_loop()
    stop_event = threading.Event()
    worker = threading.Thread(
        target=webcam_capture_thread,
        args=(camera_id, max_dim, quality, as_base64, target_fps, stop_event, current_loop),
        daemon=True,
    )
    worker.start()

    try:
        while not stop_event.is_set():
            await asyncio.sleep(0.2)
        print("[*] Running test pattern generator fallback...")
        await run_test_pattern_generator(max_dim=max_dim, quality=quality, as_base64=as_base64, target_fps=target_fps)
    finally:
        stop_event.set()


async def run_test_pattern_generator(
    max_dim: int = 768,
    quality: int = 80,
    as_base64: bool = False,
    target_fps: int = 30,
):
    """Generates a moving synthetic pattern, for testing the web app without a camera."""
    size = max(160, max_dim if max_dim > 0 else 768)
    step = 0
    delay = 1.0 / target_fps if target_fps > 0 else 0.033
    STATS.source = "test"
    STATS.set_state("streaming")
    while True:
        t_arrival = time.monotonic()
        STATS.mark_source_frame()
        if CONNECTED_CLIENTS:
            img = np.zeros((size, size, 3), dtype=np.uint8)
            img[:, :, 0] = (step * 5) % 255
            img[:, :, 1] = 60
            img[:, :, 2] = 120
            bar_x = (step * 6) % size
            img[:, bar_x : bar_x + max(4, size // 40)] = (255, 255, 255)
            scale = size / 320.0
            cv2.putText(img, f"TEST FRAME {step}", (int(20 * scale), int(140 * scale)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7 * scale, (255, 255, 255), max(1, int(2 * scale)))
            cv2.putText(img, time.strftime("%H:%M:%S"), (int(20 * scale), int(180 * scale)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6 * scale, (0, 255, 200), max(1, int(2 * scale)))
            payload = encode_jpeg(img, quality, as_base64)
            enqueue_frame_threadsafe(payload, t_arrival)
            step += 1
        await asyncio.sleep(delay)


# ---------------------------------------------------------------------------
# Project Aria glasses source
#
# Every Aria SDK call lives in a child process (glasses_worker_main). Two reasons:
#   * The SDK holds Python's global lock for the ~15 s the glasses need to start streaming.
#     In the WebSocket process that would freeze every browser for those 15 s.
#   * If the SDK ever hangs or crashes, the WebSocket server keeps running and simply
#     starts a fresh worker.
# ---------------------------------------------------------------------------


class LatestFrame:
    """Hands the newest camera frame from the SDK thread to the encoder thread."""

    def __init__(self):
        self._lock = threading.Lock()
        self._event = threading.Event()
        self._frame = None
        self._t_arrival = 0.0

    def put(self, frame: np.ndarray, t_arrival: float):
        with self._lock:
            self._frame = frame
            self._t_arrival = t_arrival
        self._event.set()

    def take(self, timeout: float):
        if not self._event.wait(timeout=timeout):
            return None, 0.0
        self._event.clear()
        with self._lock:
            frame, t_arrival = self._frame, self._t_arrival
            self._frame = None
        return frame, t_arrival


def to_owned_array(image) -> np.ndarray:
    """
    Copies an SDK image into memory we own. FastDDS lends the image buffer to Python only
    for the duration of the callback, so every thread hand-off needs its own copy.
    """
    if hasattr(image, "to_numpy_array"):
        return image.to_numpy_array().copy()
    if isinstance(image, np.ndarray):
        return image.copy()
    return np.array(image, copy=True)


class AriaStreamObserver:
    """Receives sensor data from the Aria SDK. Callbacks run on SDK threads."""

    def __init__(self, rgb_slot: LatestFrame, has_viewers, slam_feeder=None):
        self.rgb_slot = rgb_slot
        self.has_viewers = has_viewers
        self.slam_feeder = slam_feeder
        self.failed = threading.Event()
        self.failure_message = ""

    def on_image_received(self, *args, **kwargs):
        try:
            if len(args) == 2:
                image, record = args
            elif len(args) == 1:
                image = getattr(args[0], "image", args[0])
                record = args[0]
            else:
                return

            cam_id = getattr(record, "camera_id", getattr(record, "sensor_name", None))

            if cam_id == aria.CameraId.Rgb or "rgb" in str(cam_id).lower():
                # Count every frame, even with no browser attached: this is the heartbeat
                # the watchdog uses to tell a live session from a dead one.
                STATS.mark_source_frame()
                if self.has_viewers():
                    self.rgb_slot.put(to_owned_array(image), time.monotonic())
            elif self.slam_feeder is not None and cam_id in (aria.CameraId.Slam1, aria.CameraId.Slam2):
                self.slam_feeder.on_slam_image(
                    cam_id == aria.CameraId.Slam1,
                    to_owned_array(image),
                    int(record.capture_timestamp_ns),
                )
        except Exception as ex:
            print(f"\n[!] Observer frame handoff error: {ex}")

    def on_imu_received(self, samples, imu_idx):
        if self.slam_feeder is not None:
            try:
                self.slam_feeder.on_imu(samples, imu_idx)
            except Exception as ex:
                print(f"\n[!] Observer IMU handoff error: {ex}")

    def on_magneto_received(self, *args, **kwargs):
        pass

    def on_baro_received(self, *args, **kwargs):
        pass

    def on_audio_received(self, *args, **kwargs):
        pass

    def on_time_sync_received(self, *args, **kwargs):
        pass

    def on_streaming_client_failure(self, reason, message):
        self.failure_message = f"{message} ({reason})"
        print(f"\n[!] Streaming client failure: {self.failure_message}")
        self.failed.set()


class AriaSession:
    """One connection to the glasses, with the streaming session running on them."""

    def __init__(self):
        self.device_client = None
        self.device = None
        self.streaming_manager = None
        self.streaming_client = None
        self.observer = None
        self.calib_json = None
        # True when the glasses were already streaming and we attached to that session
        self.adopted = False
        self.closed = threading.Event()


def open_aria_session(interface: str, device_ip: str | None, profile: str, want_slam: bool) -> AriaSession:
    """
    Connects to the glasses and makes sure they are streaming.

    If they are already streaming, that session is reused instead of restarted. The glasses
    take about 15 s to start a session and refuse new ones for a minute or so after several
    quick restarts, so every start that can be avoided is worth avoiding.
    """
    session = AriaSession()
    try:
        _open_aria_session(session, interface, device_ip, profile, want_slam)
    except Exception:
        # Do not leak a half-open device connection into the next attempt.
        close_aria_session(session, stop_stream=False)
        raise
    return session


def _open_aria_session(session: AriaSession, interface: str, device_ip: str | None, profile: str, want_slam: bool):
    session.device_client = aria.DeviceClient()

    client_config = aria.DeviceClientConfig()
    if interface == "wifi":
        if not device_ip:
            raise ValueError("--device-ip is required when --interface wifi is selected")
        client_config.ip_v4_address = device_ip
    session.device_client.set_client_config(client_config)

    log("Connecting to Project Aria device...")
    session.device = session.device_client.connect()
    streaming_manager = session.device.streaming_manager
    session.streaming_manager = streaming_manager

    streaming_config = aria.StreamingConfig()
    streaming_config.profile_name = profile
    if interface == "usb":
        streaming_config.streaming_interface = aria.StreamingInterface.Usb
    elif interface == "wifi":
        streaming_config.streaming_interface = aria.StreamingInterface.WifiStation
    streaming_config.security_options.use_ephemeral_certs = True
    streaming_manager.streaming_config = streaming_config

    if want_slam:
        session.calib_json = streaming_manager.sensors_calibration()

    if glasses_report_streaming(session):
        log("Glasses are already streaming. Attaching to the running session...")
        session.adopted = True
    else:
        log(f"Starting sensor stream on device ({interface}, profile={profile}). This takes about 15 s...")
        streaming_manager.start_streaming()
        log(f"Streaming state: {streaming_manager.streaming_state}")

    session.streaming_client = streaming_manager.streaming_client


def restart_aria_stream(session: AriaSession, interface: str, profile: str):
    """Stops whatever session is running on the glasses and starts the one we want."""
    try:
        session.streaming_client.unsubscribe()
    except Exception:
        pass
    try:
        session.streaming_manager.stop_streaming()
    except Exception as e:
        log(f"(stop of the old session reported: {e})")
    time.sleep(3.0)
    log(f"Starting sensor stream on device ({interface}, profile={profile}). This takes about 15 s...")
    session.streaming_manager.start_streaming()
    session.adopted = False
    session.streaming_client = session.streaming_manager.streaming_client


def subscribe_aria_session(session: AriaSession, observer: AriaStreamObserver, want_slam: bool):
    """Attaches the observer and starts receiving sensor data."""
    streaming_client = session.streaming_client
    sub_config = streaming_client.subscription_config

    data_types = aria.StreamingDataType.Rgb
    if want_slam:
        data_types = data_types | aria.StreamingDataType.Slam | aria.StreamingDataType.Imu
    sub_config.subscriber_data_type = data_types

    # Only the newest RGB frame matters. SLAM needs every frame pair and every IMU sample.
    sub_config.message_queue_size[aria.StreamingDataType.Rgb] = 1
    if want_slam:
        sub_config.message_queue_size[aria.StreamingDataType.Slam] = 4
        sub_config.message_queue_size[aria.StreamingDataType.Imu] = 200

    sub_security = aria.StreamingSecurityOptions()
    sub_security.use_ephemeral_certs = True
    sub_config.security_options = sub_security
    streaming_client.subscription_config = sub_config

    session.observer = observer
    streaming_client.set_streaming_client_observer(observer)
    streaming_client.subscribe()


def glasses_report_streaming(session: AriaSession) -> bool:
    """True when the glasses themselves say a streaming session is running."""
    state = session.streaming_manager.streaming_state
    return state in (aria.StreamingState.Streaming, aria.StreamingState.Started)


def resubscribe_aria_session(session: AriaSession, observer: AriaStreamObserver, want_slam: bool):
    """Re-attaches to a session that is still running on the glasses."""
    try:
        session.streaming_client.unsubscribe()
    except Exception:
        pass
    subscribe_aria_session(session, observer, want_slam)


def close_aria_session(session: AriaSession | None, stop_stream: bool = True):
    """Releases everything a session holds. Safe to call on a half-open session."""
    if session is None:
        return
    session.closed.set()

    def stop_if_streaming():
        if not stop_stream:
            return
        try:
            still_streaming = glasses_report_streaming(session)
        except Exception:
            still_streaming = True
        if still_streaming:
            session.streaming_manager.stop_streaming()

    for label, step in (
        ("unsubscribe", lambda: session.streaming_client.unsubscribe()),
        ("stop_streaming", stop_if_streaming),
        ("disconnect", lambda: session.device_client.disconnect(session.device)),
    ):
        started = time.monotonic()
        try:
            step()
        except Exception:
            pass
        took = time.monotonic() - started
        if took > 2.0:
            log(f"(closing the old session: {label} took {took:.1f} s)")


def read_device_status(session: AriaSession):
    """Battery and thermal state, shown in the web app."""
    status = session.device.status
    return (
        int(status.battery_level),
        bool(status.thermal_mitigation_triggered),
        round(float(status.skin_temp_celsius), 1),
    )


def device_status_poller(session: AriaSession):
    """Thread: refreshes battery and temperature while the session is open."""
    delay = 5.0
    while not session.closed.wait(delay):
        delay = DEVICE_STATUS_POLL_S
        try:
            battery, thermal, skin = read_device_status(session)
        except Exception:
            continue
        if thermal and not STATS.thermal:
            log("[!] The glasses report thermal throttling. Let them cool down if the stream degrades.")
        STATS.battery, STATS.thermal, STATS.skin_temp_c = battery, thermal, skin


def rgb_encoder_worker(rgb_slot: LatestFrame, stop_event: threading.Event, emit, has_viewers, max_dim: int, quality: int, as_base64: bool):
    """Thread: encodes the freshest RGB frame as soon as it arrives. Older frames are simply replaced."""
    announced = False
    while not stop_event.is_set():
        img, t_arrival = rgb_slot.take(timeout=0.05)
        if img is None or not has_viewers():
            continue
        try:
            payload = process_aria_rgb_frame(img, max_dim=max_dim, quality=quality, as_base64=as_base64)
            if not announced:
                announced = True
                log(
                    f"[+] First RGB frame sent. Sensor {img.shape[1]}x{img.shape[0]} -> "
                    f"{STATS.width}x{STATS.height} JPEG, {len(payload) / 1024.0:.1f} KB."
                )
            emit(payload, t_arrival)
        except Exception as ex:
            print(f"\n[!] Worker encoding error: {ex}")


def adopted_session_is_usable(profile: str, stop_event: threading.Event) -> bool:
    """
    After attaching to a session that was already running: is it delivering frames, at the
    frame rate of the profile we were asked for?
    """
    deadline = time.monotonic() + 5.0
    while STATS.last_rx is None:
        if stop_event.wait(0.1) or time.monotonic() > deadline:
            return False
    frames_before, started = STATS.rx_frames, time.monotonic()
    if stop_event.wait(2.0):
        return False
    measured = (STATS.rx_frames - frames_before) / (time.monotonic() - started)
    expected = PROFILE_RGB_FPS.get(profile)
    if expected is None:
        return measured > 1.0
    usable = abs(measured - expected) <= 0.3 * expected
    if not usable:
        log(f"The running session delivers {measured:.0f} fps; {profile} should deliver {expected}.")
    return usable


def glasses_worker_main(conn, cfg: dict):
    """
    Entry point of the child process that owns every Aria SDK call.

    Keeps a streaming session alive on the glasses and passes encoded camera frames, status
    reports, and SLAM poses to the WebSocket process through `conn`.
    """
    # Ctrl+C reaches the whole process group. The parent decides when we stop, so that the
    # stream on the glasses is always shut down in an orderly way.
    signal.signal(signal.SIGINT, signal.SIG_IGN)

    stop = threading.Event()
    viewers = threading.Event()
    send_lock = threading.Lock()
    STATS.source = "aria"
    STATS.interface = cfg["interface"]
    STATS.profile = cfg["profile"]

    def send(message):
        with send_lock:
            try:
                conn.send(message)
            except (BrokenPipeError, EOFError, OSError, ValueError):
                stop.set()

    def receive_commands():
        while True:
            try:
                message = conn.recv()
            except (EOFError, OSError):
                break
            if message[0] == "viewers":
                if message[1]:
                    viewers.set()
                else:
                    viewers.clear()
            elif message[0] == "stop":
                break
        stop.set()

    threading.Thread(target=receive_commands, name="commands", daemon=True).start()

    rate = {"at": time.monotonic(), "frames": 0, "fps": 0.0}

    def report(state: str | None = None, detail: str = ""):
        if state is not None:
            STATS.set_state(state, detail)
        now = time.monotonic()
        if now - rate["at"] >= 1.0:
            rate["fps"] = (STATS.rx_frames - rate["frames"]) / (now - rate["at"])
            rate["at"], rate["frames"] = now, STATS.rx_frames
        send(("stats", {
            "state": STATS.state,
            "detail": STATS.detail,
            "rx_fps": rate["fps"],
            "restarts": STATS.restarts,
            "battery": STATS.battery,
            "thermal": STATS.thermal,
            "skin_temp_c": STATS.skin_temp_c,
            "slam": STATS.slam,
        }))

    def on_pose(pose: dict):
        # Called on a SLAM helper thread.
        STATS.slam = pose.get("status", STATS.slam)
        send(("pose", pose))

    rgb_slot = LatestFrame()
    threading.Thread(
        target=rgb_encoder_worker,
        args=(
            rgb_slot,
            stop,
            lambda payload, t_arrival: send(("frame", payload, t_arrival, STATS.width, STATS.height)),
            viewers.is_set,
            cfg["max_dim"],
            cfg["quality"],
            cfg["as_base64"],
        ),
        name="rgb-encoder",
        daemon=True,
    ).start()

    slam_feeder = None
    session: AriaSession | None = None
    failed_starts = 0

    try:
        while not stop.is_set():
            report("connecting")
            STATS.last_rx = None
            observer = None
            try:
                session = open_aria_session(cfg["interface"], cfg["device_ip"], cfg["profile"], cfg["slam"])
                if cfg["slam"] and slam_feeder is None and session.calib_json:
                    # Imported here so the bridge still runs without SLAM's extra code path.
                    from aria_slam import SlamFeeder

                    slam_feeder = SlamFeeder(session.calib_json, on_pose, record_dir=cfg["record_slam"])
                    STATS.slam = "starting"
                observer = AriaStreamObserver(rgb_slot, viewers.is_set, slam_feeder)
                subscribe_aria_session(session, observer, cfg["slam"])
                if session.adopted and not adopted_session_is_usable(cfg["profile"], stop):
                    if stop.is_set():
                        break
                    log("The running session cannot be used as it is. Restarting it cleanly...")
                    STATS.last_rx = None
                    restart_aria_stream(session, cfg["interface"], cfg["profile"])
                    subscribe_aria_session(session, observer, cfg["slam"])
            except Exception as e:
                close_aria_session(session, stop_stream=False)
                session = None
                wait = START_RETRY_WAITS_S[min(failed_starts, len(START_RETRY_WAITS_S) - 1)]
                failed_starts += 1
                log(f"[!] Could not start the glasses stream: {e}")
                log(
                    f"Trying again in {wait:.0f} s. (The glasses refuse to start for a minute or so "
                    "after several quick restarts. It clears by itself.)"
                )
                report("error", f"The glasses did not start streaming. Trying again in {wait:.0f} s.")
                if stop.wait(wait):
                    break
                continue

            log("Subscribed to the glasses. Waiting for the first camera frame...")
            threading.Thread(target=device_status_poller, args=(session,), name="device-status", daemon=True).start()
            opened_at = time.monotonic()
            last_report = 0.0
            resubscribed_at = None  # set while a cheap re-subscribe is being given a chance
            reason = ""

            while not stop.wait(0.25):
                now = time.monotonic()
                if now - last_report >= 0.5:
                    last_report = now
                    report()
                if observer.failed.is_set():
                    reason = f"SDK reported a failure: {observer.failure_message}"
                    break
                if STATS.last_rx is None:
                    if now - opened_at > FIRST_FRAME_TIMEOUT_S:
                        reason = f"no camera frame within {FIRST_FRAME_TIMEOUT_S:.0f} s of subscribing"
                        break
                    continue
                gap = now - STATS.last_rx
                since_recovery_attempt = gap if resubscribed_at is None else now - resubscribed_at
                if gap > STALL_TIMEOUT_S and since_recovery_attempt > STALL_TIMEOUT_S:
                    if resubscribed_at is None:
                        # Cheap fix first: when the glasses are still streaming (a network blip,
                        # the computer woke from sleep, a dropped subscription) re-attach to the
                        # session that is already running instead of paying for a new one.
                        try:
                            still_streaming = glasses_report_streaming(session)
                        except Exception:
                            still_streaming = False
                        if still_streaming:
                            log(f"[!] No camera frame for {gap:.1f} s but the glasses are still streaming. Re-subscribing...")
                            report("reconnecting", "re-subscribing to the glasses")
                            try:
                                resubscribe_aria_session(session, observer, cfg["slam"])
                                resubscribed_at = time.monotonic()
                                continue
                            except Exception as e:
                                log(f"Re-subscribe failed: {e}")
                    reason = f"no camera frame for {gap:.1f} s"
                    break
                if gap > STALL_WARN_S:
                    if STATS.state != "stalled":
                        report("stalled", f"no camera frame for {gap:.1f} s")
                    continue
                resubscribed_at = None
                if STATS.state != "streaming":
                    log("[+] Camera frames are arriving from the glasses.")
                    failed_starts = 0
                    report("streaming")

            if stop.is_set():
                break

            # The session is dead or stalled. Say so, then rebuild it.
            STATS.restarts += 1
            log(f"[!] Glasses stream stalled ({reason}). Restarting the session...")
            report("reconnecting", reason)
            close_aria_session(session)
            session = None
    except Exception as e:  # noqa: BLE001 - report anything unexpected, then let the parent restart us
        log(f"[!] Glasses worker failed: {e!r}")
    finally:
        stop.set()
        log("Stopping the stream on the glasses...")
        if slam_feeder is not None:
            try:
                slam_feeder.close()
            except Exception:
                pass
        close_aria_session(session)
        try:
            conn.close()
        except Exception:
            pass


def handle_worker_message(message):
    """Runs on the event loop for everything the glasses worker sends."""
    kind = message[0]
    if kind == "frame":
        _, payload, t_arrival, width, height = message
        STATS.width, STATS.height = width, height
        enqueue_frame_threadsafe(payload, t_arrival)
    elif kind == "stats":
        stats = message[1]
        changed = stats["state"] != STATS.state or stats["detail"] != STATS.detail
        STATS.set_state(stats["state"], stats["detail"])
        STATS.rx_fps = stats["rx_fps"]
        STATS.restarts = STATS.worker_restarts + stats["restarts"]
        STATS.battery, STATS.thermal, STATS.skin_temp_c = stats["battery"], stats["thermal"], stats["skin_temp_c"]
        STATS.slam = stats["slam"]
        if changed:
            broadcast_text(STATS.as_message())
    elif kind == "pose":
        STATS.slam = message[1].get("status", STATS.slam)
        broadcast_text(json.dumps(message[1]))


async def run_aria_sdk_capture(
    interface: str,
    device_ip: str | None,
    profile: str = "profile15",
    max_dim: int = 768,
    quality: int = 80,
    as_base64: bool = False,
    target_fps: int = 30,
    slam: bool = False,
    record_slam: str | None = None,
):
    """Runs the glasses worker process and relays what it sends to the browsers."""
    if aria is None:
        print("[!] Error: 'aria.sdk' (projectaria-client-sdk) is not installed.")
        print("    Install it via: pip install projectaria-client-sdk")
        print("[*] Falling back to webcam capture...")
        STATS.source = "webcam"
        await run_webcam_capture(max_dim=max_dim, quality=quality, as_base64=as_base64, target_fps=target_fps)
        return

    loop = asyncio.get_running_loop()
    ctx = multiprocessing.get_context("spawn")
    cfg = {
        "interface": interface,
        "device_ip": device_ip,
        "profile": profile,
        "max_dim": max_dim,
        "quality": quality,
        "as_base64": as_base64,
        "slam": slam,
        "record_slam": record_slam,
    }
    STATS.rx_fps_from_worker = True

    while True:
        parent_conn, child_conn = ctx.Pipe(duplex=True)
        process = ctx.Process(target=glasses_worker_main, args=(child_conn, cfg), name="aria-glasses")
        process.start()
        child_conn.close()
        worker_gone = asyncio.Event()

        def pump_messages(conn=parent_conn, gone=worker_gone):
            while True:
                try:
                    message = conn.recv()
                except (EOFError, OSError):
                    break
                loop.call_soon_threadsafe(handle_worker_message, message)
            loop.call_soon_threadsafe(gone.set)

        threading.Thread(target=pump_messages, name="glasses-messages", daemon=True).start()

        async def sync_viewers(conn=parent_conn):
            """Tells the worker whether any browser is watching, so it only encodes when needed."""
            last = None
            while True:
                watching = bool(CONNECTED_CLIENTS)
                if watching != last:
                    try:
                        conn.send(("viewers", watching))
                    except (BrokenPipeError, OSError, ValueError):
                        return
                    last = watching
                await asyncio.sleep(0.1)

        viewers_task = asyncio.create_task(sync_viewers())
        try:
            await worker_gone.wait()
        finally:
            viewers_task.cancel()
            try:
                parent_conn.send(("stop",))
            except Exception:
                pass
            # Give the worker time to stop the stream on the glasses. It can be in the middle
            # of a start, which cannot be interrupted and takes up to about 20 s.
            await loop.run_in_executor(None, process.join, 25)
            if process.is_alive():
                process.terminate()
            parent_conn.close()

        # Only reached when the worker exited by itself (an SDK crash, for example).
        STATS.worker_restarts += 1
        STATS.restarts += 1
        STATS.set_state("reconnecting", "restarting the glasses connection")
        log("[!] The glasses worker process exited unexpectedly. Starting a new one...")
        broadcast_text(STATS.as_message())
        await asyncio.sleep(2.0)


async def main():
    global FRAME_QUEUE, BUFFER_DROP_THRESHOLD
    parser = argparse.ArgumentParser(description="Meta Project Aria WebSocket stream bridge for Aria Vision")
    parser.add_argument("--host", default="0.0.0.0", help="Host IP to bind (default 0.0.0.0)")
    parser.add_argument("--port", type=int, default=7000, help="Port to listen on (default 7000; use 7001 on a Mac)")
    parser.add_argument("--mode", choices=["aria", "webcam", "test"], default="webcam",
                        help="Input source: 'aria' for Project Aria glasses, 'webcam' for local camera, 'test' for synthetic pattern")
    parser.add_argument("--interface", choices=["usb", "wifi"], default="usb", help="Aria connection interface (usb or wifi)")
    parser.add_argument("--device-ip", default=None, help="Aria glasses IP address (required for wifi)")
    parser.add_argument("--profile", default=None,
                        help="Aria streaming profile. Default: profile15 on usb (30 fps), profile18 on wifi (10 fps). "
                             "profile12 is the light 10 fps option, profile2 is 20 fps.")
    parser.add_argument("--fps", type=int, default=30,
                        help="Target FPS for webcam/test modes (default 30). Glasses always stream at their profile's rate.")
    parser.add_argument("--max-dim", type=int, default=768, help="Longest side of the picture sent to the browser (default 768)")
    parser.add_argument("--quality", type=int, default=80, help="JPEG quality 1-100 (default 80)")
    parser.add_argument("--format", choices=["binary", "base64"], default="binary",
                        help="Transmission format: 'binary' (fast raw bytes) or 'base64' (default binary)")
    parser.add_argument("--hotspot", action="store_true",
                        help="Accepted for older start scripts. No longer changes the picture: its size never affected the glasses link.")
    parser.add_argument("--slam", action="store_true",
                        help="Also receive the SLAM cameras and IMU and stream live head pose (aria mode only)")
    parser.add_argument("--record-slam", default=None, metavar="DIR",
                        help="With --slam: also save the SLAM camera frames, IMU, and calibration to DIR for offline replay")
    args = parser.parse_args()

    if args.profile is None:
        args.profile = DEFAULT_PROFILE[args.interface]

    STATS.source = args.mode
    if args.mode == "aria":
        STATS.interface = args.interface
        STATS.profile = args.profile

    # Let a few frames queue up per client before skipping; a single frame must always fit.
    approx_frame_bytes = max(32 * 1024, (args.max_dim * args.max_dim * 3) // 12)
    BUFFER_DROP_THRESHOLD = approx_frame_bytes * 3
    FRAME_QUEUE = asyncio.Queue(maxsize=1)

    print("=" * 65)
    print("  ARIA VISION - GLASSES STREAMING BRIDGE")
    print(f"  WebSocket Server: ws://{args.host}:{args.port}")
    print(f"  Mode:             {args.mode}")
    if args.mode == "aria":
        print(f"  Interface:        {args.interface}")
        fps_hint = PROFILE_RGB_FPS.get(args.profile)
        print(f"  Aria Profile:     {args.profile}" + (f" (camera sends {fps_hint} fps)" if fps_hint else ""))
        print(f"  SLAM:             {'on' if args.slam else 'off'}")
    else:
        print(f"  Target FPS:       {args.fps}")
    print(f"  Picture:          up to {args.max_dim}px, JPEG quality {args.quality}")
    print(f"  Packet Format:    {args.format}")
    if args.hotspot:
        print("  Note:             --hotspot no longer lowers picture quality.")
    if keep_computer_awake():
        print("  Keep awake:       on (this computer will not idle-sleep while the bridge runs)")
    else:
        print("  Keep awake:       not available here. Turn off sleep, or the stream stops when it sleeps.")
    print("=" * 65)

    serve_kwargs = {
        "ping_interval": 20,
        "ping_timeout": 20,
        "max_size": 10 * 1024 * 1024,
    }
    if sys.platform != "win32":
        serve_kwargs["reuse_address"] = True

    try:
        server = await websockets.serve(register_client, args.host, args.port, **serve_kwargs)
    except OSError as e:
        if "address already in use" in str(e).lower() or getattr(e, "errno", None) in (48, 98, 10048):
            print(f"\n[!] Error: Port {args.port} is already in use by another process.")
            if sys.platform == "darwin" and args.port == 7000:
                print("    On a Mac, AirPlay Receiver owns port 7000. Run the bridge with --port 7001")
                print('    and set VITE_ARIA_STREAM_URL="ws://localhost:7001" in .env.')
            else:
                print("    Stop the other bridge (pkill -f aria_bridge.py) or choose another port:")
                print(f"        --port {args.port + 1}\n")
        raise

    dispatcher_task = asyncio.create_task(frame_dispatcher())
    telemetry_task = asyncio.create_task(telemetry_reporter())

    # A plain `kill` should shut down as cleanly as Ctrl+C, so the glasses stop streaming too.
    if sys.platform != "win32":
        main_task = asyncio.current_task()
        asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, main_task.cancel)

    as_base64 = args.format == "base64"

    try:
        if args.mode == "aria":
            await run_aria_sdk_capture(
                interface=args.interface,
                device_ip=args.device_ip,
                profile=args.profile,
                max_dim=args.max_dim,
                quality=args.quality,
                as_base64=as_base64,
                target_fps=args.fps,
                slam=args.slam,
                record_slam=args.record_slam,
            )
        elif args.mode == "webcam":
            await run_webcam_capture(
                max_dim=args.max_dim,
                quality=args.quality,
                as_base64=as_base64,
                target_fps=args.fps,
            )
        else:
            await run_test_pattern_generator(
                max_dim=args.max_dim,
                quality=args.quality,
                as_base64=as_base64,
                target_fps=args.fps,
            )
    finally:
        dispatcher_task.cancel()
        telemetry_task.cancel()
        server.close()
        await server.wait_closed()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, asyncio.CancelledError):
        print("\n[*] Bridge stopped.")
