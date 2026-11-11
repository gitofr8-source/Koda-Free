import os
import json
import base64
import sqlite3
import shutil
import ctypes
from ctypes import wintypes
import re
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

class DATA_BLOB(ctypes.Structure):
    _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_byte))]

def decrypt_dpapi(data):
    blob_in = DATA_BLOB(len(data), (ctypes.c_byte * len(data))(*data))
    blob_out = DATA_BLOB()
    if ctypes.windll.crypt32.CryptUnprotectData(ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)):
        res = ctypes.string_at(blob_out.pbData, blob_out.cbData)
        ctypes.windll.kernel32.LocalFree(blob_out.pbData)
        return res
    return None

def get_claude_cookies():
    data_dir = os.path.expandvars(r'%LOCALAPPDATA%\Claude-Data\claude_pzs8sxrjxfjjc')
    local_state_path = os.path.join(data_dir, 'Local State')
    cookies_db_path = os.path.join(data_dir, 'Network', 'Cookies')

    if not os.path.exists(local_state_path) or not os.path.exists(cookies_db_path):
        return {}

    try:
        with open(local_state_path, 'r', encoding='utf-8') as f:
            local_state = json.load(f)
        encrypted_key = base64.b64decode(local_state['os_crypt']['encrypted_key'])[5:]
        master_key = decrypt_dpapi(encrypted_key)
        aesgcm = AESGCM(master_key)

        tmp_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
        os.makedirs(tmp_dir, exist_ok=True)
        tmp_db = os.path.join(tmp_dir, 'claude_tmp_cookies.db')
        shutil.copyfile(cookies_db_path, tmp_db)

        conn = sqlite3.connect(tmp_db)
        cursor = conn.cursor()
        cursor.execute("SELECT name, encrypted_value FROM cookies WHERE host_key LIKE '%claude.ai%'")
        rows = cursor.fetchall()
        conn.close()
        try: os.remove(tmp_db)
        except: pass

        cookies = {}
        for name, enc in rows:
            try:
                dec = aesgcm.decrypt(enc[3:15], enc[15:], None)
                s = dec.decode('utf-8', errors='ignore')
                # Find start of printable content
                m = re.search(r'[\x20-\x7E]{2,}', s)
                if m:
                    val = m.group(0).strip()
                    if name in ('sessionKey', 'sessionKeyV3'):
                        idx = s.find('sk-ant-sid02-')
                        if idx != -1: val = s[idx:].split('\x00')[0].strip()
                    cookies[name] = val
            except:
                pass
        return cookies
    except:
        return {}

def get_claude_session():
    data_dir = os.path.expandvars(r'%LOCALAPPDATA%\Claude-Data\claude_pzs8sxrjxfjjc')
    local_state_path = os.path.join(data_dir, 'Local State')
    cookies_db_path = os.path.join(data_dir, 'Network', 'Cookies')

    if not os.path.exists(local_state_path) or not os.path.exists(cookies_db_path):
        return {"error": "Claude Desktop data directory not found"}

    try:
        with open(local_state_path, 'r', encoding='utf-8') as f:
            local_state = json.load(f)

        encrypted_key = base64.b64decode(local_state['os_crypt']['encrypted_key'])[5:]
        master_key = decrypt_dpapi(encrypted_key)

        tmp_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
        os.makedirs(tmp_dir, exist_ok=True)
        tmp_db = os.path.join(tmp_dir, 'claude_tmp_cookies.db')

        shutil.copyfile(cookies_db_path, tmp_db)
        conn = sqlite3.connect(tmp_db)
        cursor = conn.cursor()
        cursor.execute("SELECT name, encrypted_value FROM cookies WHERE name IN ('sessionKey', 'sessionKeyV3', 'lastActiveOrg')")
        rows = dict(cursor.fetchall())
        conn.close()
        try:
            os.remove(tmp_db)
        except:
            pass

        aesgcm = AESGCM(master_key)
        session_key = None
        org_id = None

        for name in ['sessionKeyV3', 'sessionKey']:
            if name in rows:
                enc = rows[name]
                dec = aesgcm.decrypt(enc[3:15], enc[15:], None)
                idx = dec.find(b'sk-ant-sid02-')
                if idx != -1:
                    session_key = dec[idx:].decode('utf-8', errors='ignore').split('\x00')[0].strip()
                    break

        if 'lastActiveOrg' in rows:
            enc = rows['lastActiveOrg']
            dec = aesgcm.decrypt(enc[3:15], enc[15:], None)
            m = re.search(rb'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', dec)
            if m:
                org_id = m.group(0).decode('utf-8')

        return {
            "ok": bool(session_key),
            "sessionKey": session_key,
            "orgId": org_id,
            "user": "smrn.g1286@gmail.com"
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}

if __name__ == '__main__':
    print(json.dumps(get_claude_session()))
