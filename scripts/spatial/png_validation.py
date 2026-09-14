"""Bounded PNG integrity checks shared by render recovery and local verification."""
import struct
import zlib


def complete_png(path, dimensions=None):
    try:
        with path.open('rb') as handle:
            if handle.read(8) != b'\x89PNG\r\n\x1a\n':
                return False
            first, pixels, total = True, False, 8
            while total < 32 * 1024 * 1024:
                header = handle.read(8)
                if len(header) != 8:
                    return False
                length, kind = struct.unpack('>I4s', header)
                if length > 16 * 1024 * 1024:
                    return False
                data, checksum = handle.read(length), handle.read(4)
                if len(data) != length or len(checksum) != 4:
                    return False
                if zlib.crc32(data, zlib.crc32(kind)) & 0xffffffff != struct.unpack('>I', checksum)[0]:
                    return False
                total += length + 12
                if first:
                    if kind != b'IHDR' or length != 13:
                        return False
                    if dimensions and struct.unpack('>II', data[:8]) != dimensions:
                        return False
                    first = False
                elif kind == b'IHDR':
                    return False
                if kind == b'IDAT':
                    pixels = True
                if kind == b'IEND':
                    return length == 0 and pixels and not handle.read(1)
    except (OSError, ValueError, struct.error):
        return False
    return False
