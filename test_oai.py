import os, json, base64, sqlite3, shutil, ctypes
from ctypes import wintypes
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

chrome_dir = os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\User Data')
cookies_db = os.path.join(chrome_dir, 'Default', 'Network', 'Cookies')
local_state = os.path.join(chrome_dir, 'Local State')

with open(local_state, 'r', encoding='utf-8') as f:
    ls = json.load(f)
enc_key = base64.b64decode(ls['os_crypt']['encrypted_key'])[5:]
master_key = decrypt_dpapi(enc_key)
aesgcm = AESGCM(master_key)

shutil.copyfile(cookies_db, 'tmp_chk.db')
conn = sqlite3.connect('tmp_chk.db')
c = conn.cursor()
c.execute("SELECT name, encrypted_value FROM cookies WHERE host_key LIKE '%chatgpt%'")
rows = c.fetchall()
conn.close()
try: os.remove('tmp_chk.db')
except: pass

print('Total rows found in DB:', len(rows))
for name, enc in rows:
    try:
        dec = aesgcm.decrypt(enc[3:15], enc[15:], None)
        print('Decrypted:', name, 'len:', len(dec))
    except Exception as e:
        print('Fail decrypt', name, e)
