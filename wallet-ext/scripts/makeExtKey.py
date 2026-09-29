"""
Hasilkan pasangan kunci untuk `manifest.json` extension (field `key`).

Kenapa: tanpa `key`, Chrome menurunkan ID extension dari PATH folder saat
memuat unpacked. Artinya ID berubah kalau folder dipindah, sehingga URL popup
(`chrome-extension://<id>/popup.html`) tidak bisa diprediksi untuk pengujian.
Dengan `key` yang tetap, ID-nya stabil selamanya.

Jalankan sekali:
    python scripts/makeExtKey.py

Lalu tempel nilai KEY ke `public/manifest.json` (field "key").
ID yang dihasilkan dicetak — pakai untuk memverifikasi URL popup.

CATATAN KEAMANAN: ini kunci RSA untuk identitas extension, BUKAN untuk
menandatangani kode. Ia boleh ada di repo (banyak extension open-source
melakukannya). Untuk publish ke Web Store, kunci yang sama harus dikunci di
dashboard developer.
"""

import base64
import hashlib
import sys

try:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
except ImportError:
    sys.exit("pip install cryptography")


def main() -> None:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    spki = key.public_key().public_bytes(
        serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    manifest_key = base64.b64encode(spki).decode()

    digest = hashlib.sha256(spki).hexdigest()[:32]
    ext_id = "".join("abcdefghijklmnop"[int(c, 16)] for c in digest)

    print("KEY (tempel ke public/manifest.json sebagai \"key\"):\n")
    print(manifest_key)
    print(f"\nID extension: {ext_id}")
    print(f"URL popup   : chrome-extension://{ext_id}/popup.html")


if __name__ == "__main__":
    main()
