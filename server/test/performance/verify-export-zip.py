#!/usr/bin/env python3
"""獨立使用 Python stdlib 串流驗證每個 ZIP entry，不解壓至磁碟。"""
import argparse
import hashlib
import json
import struct
import time
import zipfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("zip", type=Path)
    parser.add_argument("expected", type=Path)
    parser.add_argument("--require-zip64", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    start = time.monotonic()
    data = json.loads(args.expected.read_text())
    entries = data["entries"] if isinstance(data, dict) else data
    expected = {entry["zipPath"]: entry for entry in entries}
    if len(expected) != len(entries):
        raise SystemExit("Duplicate expected ZIP names")

    size = args.zip.stat().st_size
    # EOCD、最大 ZIP comment 與 ZIP64 locator/record；不讀取整包。
    with args.zip.open("rb") as source:
        source.seek(max(0, size - 131072))
        tail = source.read()
    eocd = tail.rfind(b"PK\x05\x06")
    if eocd < 0:
        raise SystemExit("Missing EOCD")
    locator = eocd - 20
    zip64 = locator >= 0 and tail[locator:locator + 4] == b"PK\x06\x07"
    if zip64:
        _disk, offset, _disks = struct.unpack_from("<IQI", tail, locator + 4)
        with args.zip.open("rb") as source:
            source.seek(offset)
            record = source.read(56)
        if record[:4] != b"PK\x06\x06":
            raise SystemExit("ZIP64 locator does not reference ZIP64 EOCD")
    if args.require_zip64 and not zip64:
        raise SystemExit("Expected ZIP64 EOCD/locator")

    verified = 0
    with zipfile.ZipFile(args.zip) as archive:
        infos = archive.infolist()
        names = [info.filename for info in infos]
        if len(names) != len(set(names)):
            raise SystemExit("Duplicate archive entries")
        if set(names) != set(expected):
            raise SystemExit(
                f"Entry mismatch: missing {len(set(expected) - set(names))}, "
                f"unexpected {len(set(names) - set(expected))}"
            )
        for info in infos:
            entry = expected[info.filename]
            if info.file_size != entry["bytes"]:
                raise SystemExit("Size mismatch: " + info.filename)
            digest = hashlib.sha256()
            count = 0
            with archive.open(info) as source:
                while chunk := source.read(1024 * 1024):
                    digest.update(chunk)
                    count += len(chunk)
            # zipfile 在完整讀取時也驗 CRC；SHA 用生成 fixture 的獨立 manifest。
            if count != entry["bytes"] or digest.hexdigest() != entry["sha256"]:
                raise SystemExit("Hash mismatch: " + info.filename)
            verified += count

    result = {
        "zip": str(args.zip),
        "zipBytes": size,
        "entryCount": len(expected),
        "uncompressedBytes": verified,
        "zip64": zip64,
        "allEntryHashesMatch": True,
        "seconds": time.monotonic() - start,
        "verifier": "Python stdlib zipfile; CRC and SHA-256; no extraction",
    }
    text = json.dumps(result, indent=2) + "\n"
    if args.output:
        args.output.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
