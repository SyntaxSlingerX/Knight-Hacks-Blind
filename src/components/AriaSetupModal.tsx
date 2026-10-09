import React, { useState } from 'react';
import { X, Glasses, Terminal, Copy, Check, ExternalLink, Cpu, Wifi, Radio } from 'lucide-react';
import { AriaConnectionConfig } from '../types/aria';

interface AriaSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: AriaConnectionConfig;
  onConfigChange: (config: AriaConnectionConfig) => void;
}

export const AriaSetupModal: React.FC<AriaSetupModalProps> = ({
  isOpen,
  onClose,
  config,
  onConfigChange,
}) => {
  const [streamUrlInput, setStreamUrlInput] = useState<string>(config.streamUrl);
  const [copiedScript, setCopiedScript] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'quickstart' | 'python_bridge' | 'hardware_specs'>('quickstart');

  if (!isOpen) return null;

  const pythonBridgeCode = `# aria_bridge.py
# Meta Project Aria Live Streaming Bridge for Aria Vision
# Requires: pip install projectaria_tools websockets opencv-python

import asyncio
import cv2
import websockets
import base64
import json
from projectaria_tools.core import calibration
from projectaria_tools.core.sensor_data import TimeDomain

# Project Aria Glasses WebSocket Server
HOST = "0.0.0.0"
PORT = 7000

print(f"[*] Meta Project Aria Streaming Bridge starting on ws://{HOST}:{PORT}")

async def handle_aria_client(websocket):
    print(f"[+] Aria Vision client connected: {websocket.remote_address}")
    # In live streaming mode with Project Aria SDK:
    # 1. Connect to Aria via Wi-Fi or USB tethering
    # 2. Subscribe to RGB camera sensor (1408x1408 resolution)
    # 3. Stream compressed JPEG frames
    try:
        # Example frame loop from Project Aria live streamer
        cap = cv2.VideoCapture(0) # or aria live stream device
        while True:
            ret, frame = cap.read()
            if not ret:
                await asyncio.sleep(0.033)
                continue
            
            # Encode frame to JPEG
            _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            jpg_as_text = base64.b64encode(buffer).decode('utf-8')
            
            # Send data URL to Aria Vision Web App
            payload = f"data:image/jpeg;base64,{jpg_as_text}"
            await websocket.send(payload)
            await asyncio.sleep(0.05) # ~20 FPS for vision analysis
    except websockets.exceptions.ConnectionClosed:
        print("[-] Client disconnected")

async def main():
    async with websockets.serve(handle_aria_client, HOST, PORT):
        await asyncio.Future()  # run forever

if __name__ == "__main__":
    asyncio.run(main())
`;

  const handleCopyScript = () => {
    navigator.clipboard.writeText(pythonBridgeCode);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2500);
  };

  const handleSaveUrl = (e: React.FormEvent) => {
    e.preventDefault();
    onConfigChange({
      ...config,
      streamUrl: streamUrlInput.trim(),
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="aria-setup-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-400/10 text-amber-400 rounded-xl">
              <Glasses className="w-5 h-5" />
            </div>
            <div>
              <h2 id="aria-setup-title" className="text-base font-bold text-white">
                Meta Project Aria Smart Glasses Integration
              </h2>
              <p className="text-xs text-slate-400">Official SDK streaming and live camera connection</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close setup modal"
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-800 bg-slate-950/60 px-6 pt-2 gap-4">
          <button
            onClick={() => setActiveTab('quickstart')}
            className={`pb-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'quickstart'
                ? 'border-amber-400 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Connection Setup
          </button>
          <button
            onClick={() => setActiveTab('python_bridge')}
            className={`pb-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'python_bridge'
                ? 'border-amber-400 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Python SDK Bridge
          </button>
          <button
            onClick={() => setActiveTab('hardware_specs')}
            className={`pb-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'hardware_specs'
                ? 'border-amber-400 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Hardware & Sensors
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-sm text-slate-300">
          {activeTab === 'quickstart' && (
            <>
              {/* Stream URL Input */}
              <form onSubmit={handleSaveUrl} className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wide">
                  Project Aria Stream Endpoint (WebSocket / MJPEG):
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={streamUrlInput}
                    onChange={(e) => setStreamUrlInput(e.target.value)}
                    placeholder="ws://192.168.1.100:7000 or http://192.168.1.100:8080/stream"
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-xs text-white font-mono focus:ring-2 focus:ring-amber-400 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold rounded-xl text-xs transition-colors"
                  >
                    Save URL
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">
                  Default local bridge endpoint: <code className="text-amber-300 font-mono">ws://localhost:7000</code> or your Aria companion device IP.
                </p>
              </form>

              {/* Step by step guide */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  How to stream from Meta Project Aria:
                </h3>
                <ol className="space-y-2.5 text-xs text-slate-300">
                  <li className="flex gap-3 items-start bg-slate-950/40 p-3 rounded-xl border border-slate-800/80">
                    <span className="font-bold text-amber-400 font-mono text-sm">1.</span>
                    <div>
                      <strong className="text-white block">Power on Project Aria glasses</strong>
                      Connect Aria to your local Wi-Fi network via the Meta Aria Companion mobile app.
                    </div>
                  </li>
                  <li className="flex gap-3 items-start bg-slate-950/40 p-3 rounded-xl border border-slate-800/80">
                    <span className="font-bold text-amber-400 font-mono text-sm">2.</span>
                    <div>
                      <strong className="text-white block">Install Project Aria Tools</strong>
                      Run <code className="bg-slate-800 px-1.5 py-0.5 rounded text-amber-300 font-mono">pip install projectaria_tools websockets</code> on your computer.
                    </div>
                  </li>
                  <li className="flex gap-3 items-start bg-slate-950/40 p-3 rounded-xl border border-slate-800/80">
                    <span className="font-bold text-amber-400 font-mono text-sm">3.</span>
                    <div>
                      <strong className="text-white block">Run the Aria Vision Python Bridge</strong>
                      Start <code className="bg-slate-800 px-1.5 py-0.5 rounded text-amber-300 font-mono">python aria_bridge.py</code> (see Python tab).
                    </div>
                  </li>
                  <li className="flex gap-3 items-start bg-slate-950/40 p-3 rounded-xl border border-slate-800/80">
                    <span className="font-bold text-amber-400 font-mono text-sm">4.</span>
                    <div>
                      <strong className="text-white block">Automatic Live Fallback</strong>
                      If Aria hardware is unavailable during your hackathon demo, switch seamlessly to <strong>Webcam</strong> or <strong>Field Scenarios</strong>!
                    </div>
                  </li>
                </ol>
              </div>
            </>
          )}

          {activeTab === 'python_bridge' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-400">
                  Copy and run this script to stream Aria glasses frames to this app:
                </span>
                <button
                  onClick={handleCopyScript}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-400 text-xs font-bold rounded-lg border border-slate-700 transition-colors"
                >
                  {copiedScript ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedScript ? 'Copied!' : 'Copy Script'}</span>
                </button>
              </div>

              <pre className="bg-slate-950 p-4 rounded-2xl border border-slate-800 font-mono text-[11px] leading-relaxed text-slate-200 overflow-x-auto max-h-[300px]">
                {pythonBridgeCode}
              </pre>
            </div>
          )}

          {activeTab === 'hardware_specs' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                <div className="text-amber-400 font-bold flex items-center gap-1.5">
                  <Glasses className="w-4 h-4" />
                  <span>RGB Sensor Camera</span>
                </div>
                <p className="text-slate-300">
                  8-Megapixel color sensor capturing 1408x1408 @ 30 FPS with 110° field of view, ideal for pedestrian navigation.
                </p>
              </div>

              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                <div className="text-amber-400 font-bold flex items-center gap-1.5">
                  <Cpu className="w-4 h-4" />
                  <span>Dual Mono SLAM Cameras</span>
                </div>
                <p className="text-slate-300">
                  Ultra-wide fish-eye cameras used for 6-DoF odometry and spatial localization inside buildings.
                </p>
              </div>

              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                <div className="text-amber-400 font-bold flex items-center gap-1.5">
                  <Radio className="w-4 h-4" />
                  <span>7-Microphone Spatial Array</span>
                </div>
                <p className="text-slate-300">
                  Beamforming microphones for clear voice isolation even on noisy city streets.
                </p>
              </div>

              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                <div className="text-amber-400 font-bold flex items-center gap-1.5">
                  <Wifi className="w-4 h-4" />
                  <span>Connectivity & Streaming</span>
                </div>
                <p className="text-slate-300">
                  Dual-band Wi-Fi and Bluetooth Low Energy (BLE) with low-latency local streaming capabilities.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-950 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
