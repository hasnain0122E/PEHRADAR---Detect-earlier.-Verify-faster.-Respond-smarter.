"""Process memory readings in MB: Linux /proc, Windows psapi, otherwise None."""

import sys
from pathlib import Path


def rss_mb() -> float | None:
    return _read()[0]


def peak_rss_mb() -> float | None:
    """Peak resident memory over the whole process lifetime."""
    return _read()[1]


def _read() -> tuple[float | None, float | None]:
    if sys.platform == "win32":
        return _read_windows()
    try:
        status = Path("/proc/self/status").read_text()
    except OSError:
        return None, None
    values = {}
    for line in status.splitlines():
        key, _, rest = line.partition(":")
        if key in ("VmRSS", "VmHWM"):
            values[key] = round(int(rest.split()[0]) / 1024, 1)
    return values.get("VmRSS"), values.get("VmHWM")


def _read_windows() -> tuple[float | None, float | None]:
    import ctypes
    import ctypes.wintypes as wt

    class Counters(ctypes.Structure):
        _fields_ = [
            ("cb", wt.DWORD),
            ("PageFaultCount", wt.DWORD),
            ("PeakWorkingSetSize", ctypes.c_size_t),
            ("WorkingSetSize", ctypes.c_size_t),
            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
            ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
            ("PagefileUsage", ctypes.c_size_t),
            ("PeakPagefileUsage", ctypes.c_size_t),
        ]

    counters = Counters()
    counters.cb = ctypes.sizeof(counters)
    kernel32 = ctypes.WinDLL("kernel32")
    kernel32.GetCurrentProcess.restype = wt.HANDLE
    psapi = ctypes.WinDLL("psapi")
    psapi.GetProcessMemoryInfo.argtypes = [wt.HANDLE, ctypes.POINTER(Counters), wt.DWORD]
    if not psapi.GetProcessMemoryInfo(
        kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb
    ):
        return None, None
    mb = 1024 * 1024
    return round(counters.WorkingSetSize / mb, 1), round(counters.PeakWorkingSetSize / mb, 1)
