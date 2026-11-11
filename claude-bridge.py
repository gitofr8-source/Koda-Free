#!/usr/bin/env python3
"""
Koda Claude Ultra-Fast Browserless Live Mirror Bridge (Port 3002)
- Zero Chrome / Zero Browser Processes
- Persistent warm HTTP/2 Session (no TLS handshake overhead)
- Unbuffered stream chunk processing (instant token emission)
- 100% Fallback to Gemini 3.1 & Ollama if Claude Desktop is throttled or offline
"""

import os
import sys
import json
import uuid
import time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from curl_cffi import requests

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import importlib.util

session_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'claude-session.py')
spec = importlib.util.spec_from_file_location('claude_session', session_script)
claude_session = importlib.util.module_from_spec(spec)
spec.loader.exec_module(claude_session)

PORT = 3002

cached_session = None
http_session = None
active_conv_uuid = None

def get_session():
    global cached_session, http_session
    if cached_session and cached_session.get("ok") and http_session:
        return cached_session
    cached_session = claude_session.get_claude_session()
    if cached_session and cached_session.get("ok"):
        http_session = requests.Session(impersonate='chrome124')
        http_session.cookies.set('sessionKey', cached_session.get('sessionKey'), domain='claude.ai')
    return cached_session

class ClaudeBridgeHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def setup(self):
        super().setup()
        try:
            self.request.settimeout(15.0)
        except Exception:
            pass

    def log_message(self, format, *args):
        pass

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        if self.path == '/api/claude/status':
            session = get_session()
            ready = bool(session and session.get("ok"))
            resp = {
                "ready": ready,
                "appRunning": ready,
                "user": session.get("user", "smrn.g1286@gmail.com") if ready else None,
                "title": "Claude Mirror Bridge (Browserless)",
                "message": "Claude Direct API Bridge connected" if ready else "No Claude Desktop session found"
            }
            body = json.dumps(resp).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            self.wfile.flush()
            return

        if self.path == '/api/claude/login':
            global cached_session, http_session, active_conv_uuid
            cached_session = None
            http_session = None
            active_conv_uuid = None
            session = get_session()
            ready = bool(session and session.get("ok"))
            resp = {
                "ok": ready,
                "message": "Connected directly to Claude account" if ready else "Claude Desktop session not detected"
            }
            body = json.dumps(resp).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            self.wfile.flush()
            return

        self.send_response(404)
        self.end_headers()

    def stream_fallback(self, prompt):
        """Fallback to Gemini 3.1 & Ollama so Claude response is ALWAYS instant and never errors"""
        try:
            import urllib.request
            g_key = os.environ.get('GEMINI_API_KEY', '')
            if not g_key:
                try:
                    vk_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'server-keys.json')
                    if os.path.exists(vk_path):
                        with open(vk_path, 'r', encoding='utf-8') as f:
                            g_key = json.load(f).get('gemini', '')
                except Exception:
                    pass
            g_payload = json.dumps({
                'systemInstruction': {'parts': [{'text': 'You are Claude by Anthropic. Answer with exceptional nuance, directness, and thoughtful clarity.'}]},
                'contents': [{'role': 'user', 'parts': [{'text': prompt}]}],
                'generationConfig': {'temperature': 0.7, 'topP': 0.9, 'maxOutputTokens': 2048}
            }).encode()
            fallback_models = ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview', 'gemini-3-flash-preview', 'gemma-4-26b-a4b-it']
            fb_success = False
            for cur_m in fallback_models:
                if fb_success:
                    break
                g_url = f'https://generativelanguage.googleapis.com/v1beta/models/{cur_m}:streamGenerateContent?alt=sse&key={g_key}'
                g_req = urllib.request.Request(g_url, data=g_payload, headers={'Content-Type': 'application/json'})
                try:
                    with urllib.request.urlopen(g_req, timeout=5) as g_resp:
                        if g_resp.status == 200:
                            for line in g_resp:
                                decoded = line.decode('utf-8', errors='ignore').strip()
                                if decoded.startswith('data: '):
                                    d_str = decoded[6:]
                                    try:
                                        c_data = json.loads(d_str)
                                        tok = c_data.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '')
                                        if tok:
                                            fb_success = True
                                            self.wfile.write(f'data: {json.dumps({"delta": tok})}\n\n'.encode('utf-8'))
                                            self.wfile.flush()
                                    except Exception:
                                        pass
                except Exception:
                    continue

            if not fb_success:
                # Ollama local fallback
                try:
                    o_payload = json.dumps({
                        'model': 'qwen2.5:3b',
                        'messages': [
                            {'role': 'system', 'content': 'You are Claude by Anthropic. Answer with exceptional nuance, directness, and thoughtful clarity.'},
                            {'role': 'user', 'content': prompt}
                        ],
                        'stream': True
                    }).encode()
                    o_req = urllib.request.Request('http://127.0.0.1:11434/v1/chat/completions', data=o_payload, headers={'Content-Type': 'application/json'})
                    with urllib.request.urlopen(o_req, timeout=12) as o_resp:
                        if o_resp.status == 200:
                            for line in o_resp:
                                decoded = line.decode('utf-8', errors='ignore').strip()
                                if decoded.startswith('data: '):
                                    d_str = decoded[6:].strip()
                                    if d_str == '[DONE]':
                                        break
                                    try:
                                        oj = json.loads(d_str)
                                        otok = oj.get('choices', [{}])[0].get('delta', {}).get('content', '')
                                        if otok:
                                            fb_success = True
                                            self.wfile.write(f'data: {json.dumps({"delta": otok})}\n\n'.encode('utf-8'))
                                            self.wfile.flush()
                                    except Exception:
                                        pass
                except Exception:
                    pass

            self.wfile.write(b'data: [DONE]\n\n')
            self.wfile.flush()
        except Exception:
            try:
                self.wfile.write(b'data: [DONE]\n\n')
                self.wfile.flush()
            except Exception:
                pass

    def do_POST(self):
        global active_conv_uuid
        if self.path == '/api/claude/login':
            return self.do_GET()

        if self.path == '/api/claude/send':
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 0:
                raw_body = self.rfile.read(content_length).decode('utf-8', errors='ignore')
            else:
                raw_body = ''
            try:
                data = json.loads(raw_body) if raw_body else {}
            except:
                data = {}

            prompt = (data.get('prompt') or '').strip()
            if not prompt:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Connection', 'close')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Prompt is required"}).encode('utf-8'))
                self.close_connection = True
                return

            # Always start response headers immediately
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
            self.send_header('Cache-Control', 'no-cache, no-transform')
            self.send_header('Connection', 'close')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(b': ping\n\n')
            self.wfile.flush()

            session = get_session()
            if not session or not session.get("ok") or not http_session:
                self.stream_fallback(prompt)
                self.close_connection = True
                return

            org_id = session.get('orgId')
            req_headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/event-stream, text/plain',
                'Content-Type': 'application/json',
                'Referer': 'https://claude.ai/chat/new'
            }

            try:
                # Always ensure a conversation exists
                if not active_conv_uuid:
                    new_uuid = str(uuid.uuid4())
                    r_conv = http_session.post(
                        f'https://claude.ai/api/organizations/{org_id}/chat_conversations',
                        json={'uuid': new_uuid, 'name': ''},
                        headers=req_headers,
                        timeout=8
                    )
                    if r_conv.status_code in (200, 201):
                        active_conv_uuid = new_uuid

                conv_id = active_conv_uuid or str(uuid.uuid4())

                # Send completion
                payload = {
                    'prompt': prompt,
                    'timezone': 'Asia/Kolkata',
                    'model': 'claude-sonnet-5-5',
                    'attachments': [],
                    'files': []
                }

                r_msg = http_session.post(
                    f'https://claude.ai/api/organizations/{org_id}/chat_conversations/{conv_id}/completion',
                    json=payload,
                    headers=req_headers,
                    stream=True,
                    timeout=8
                )

                if r_msg.status_code != 200:
                    self.stream_fallback(prompt)
                    self.close_connection = True
                    return

                # Real-time unbuffered token streaming
                accumulated = ""
                raw_buf = b""
                stream_finished = False
                for chunk in r_msg.iter_content(chunk_size=None):
                    if stream_finished:
                        break
                    if not chunk:
                        continue
                    raw_buf += chunk
                    while b"\n" in raw_buf:
                        line, raw_buf = raw_buf.split(b"\n", 1)
                        line = line.strip()
                        if not line:
                            continue
                        decoded = line.decode('utf-8', errors='ignore')
                        if decoded.startswith('data: '):
                            raw_data = decoded[6:].strip()
                            if raw_data == '[DONE]':
                                stream_finished = True
                                break
                            try:
                                chunk_json = json.loads(raw_data)
                                delta = chunk_json.get('completion', '')
                                if delta:
                                    accumulated += delta
                                    ev = f'data: {json.dumps({"delta": delta})}\n\n'
                                    self.wfile.write(ev.encode('utf-8'))
                                    self.wfile.flush()
                                if chunk_json.get('stop_reason'):
                                    stream_finished = True
                                    break
                            except:
                                pass

                try:
                    r_msg.close()
                except:
                    pass

                # Final completion event
                if accumulated:
                    done_event = f'data: {json.dumps({"done": True, "fullText": accumulated})}\n\n'
                    self.wfile.write(done_event.encode('utf-8'))
                    self.wfile.write(b'data: [DONE]\n\n')
                    self.wfile.flush()
                else:
                    self.stream_fallback(prompt)

            except Exception:
                self.stream_fallback(prompt)
            finally:
                self.close_connection = True
            return

        self.send_response(404)
        self.end_headers()

def run():
    print(f"=======================================================", flush=True)
    print(f"  Koda Claude Ultra-Fast Browserless Bridge is ACTIVE", flush=True)
    print(f"  ZERO Chrome / ZERO Browser Processes", flush=True)
    print(f"  Listening on: http://127.0.0.1:{PORT}", flush=True)
    print(f"=======================================================", flush=True)
    server = ThreadingHTTPServer(('127.0.0.1', PORT), ClaudeBridgeHandler)
    server.serve_forever()

if __name__ == '__main__':
    run()
