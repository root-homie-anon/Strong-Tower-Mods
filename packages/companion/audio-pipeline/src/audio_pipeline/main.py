from __future__ import annotations

import atexit
import os
import pathlib
import signal
import sys

import uvicorn

from .server import app

SIDECAR_PORT = int(os.environ.get('SIDECAR_PORT', '4999'))

# Lockfile path: one sidecar per machine user. The sidecar owns a single WebSocket connection
# to the cloud whose Authorization header carries the JWT minted at session start. If two
# sidecars ran simultaneously they would share that connection and could mix JWT identities
# across turns — a silent auth-binding failure. The lockfile prevents this.
#
# Path on every supported platform is ``~/.local/share/strong-tower-mods/sidecar.pid``.
# That resolves to ``C:\Users\<user>\.local\share\strong-tower-mods\sidecar.pid`` on
# Windows — non-idiomatic for Windows (the canonical home would be ``%LOCALAPPDATA%``)
# but it keeps the path identical across POSIX and Windows so debug instructions work
# verbatim on both. The PyInstaller-frozen sidecar (Phase F1, dist-frozen/sidecar.exe)
# uses the same logic; if a future revision wants the proper Windows convention,
# branch on ``sys.platform`` here and update ``audio-pipeline/packaging/sidecar.spec``
# along with it.

def _lockfile_path() -> pathlib.Path:
    base = pathlib.Path.home() / '.local' / 'share' / 'strong-tower-mods'
    return base / 'sidecar.pid'


def _pid_is_alive(pid: int) -> bool:
    """Return True if a process with the given PID is running on this machine.

    Cross-platform: on POSIX, ``os.kill(pid, 0)`` raises ``ProcessLookupError``
    for absent processes and ``PermissionError`` for processes we cannot
    signal. On Windows, the same call raises ``OSError`` with
    ``winerror == 87`` ("invalid parameter") for stale PIDs — a stale
    lockfile must not block sidecar startup, so that case is treated as
    not alive.
    """
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        # kill(pid, 0) raises PermissionError when the process exists but we cannot signal it.
        return True
    except OSError as exc:
        if getattr(exc, 'winerror', None) == 87:
            return False
        raise


def _acquire_lockfile() -> pathlib.Path:
    lockfile = _lockfile_path()

    if lockfile.exists():
        try:
            pid = int(lockfile.read_text().strip())
        except (ValueError, OSError):
            pid = None

        if pid is not None and _pid_is_alive(pid):
            sys.exit(
                f'Another sidecar is already running (PID {pid}). '
                f'Refusing to start. If this is wrong, remove {lockfile}'
            )
        # Stale lockfile — overwrite it below.

    lockfile.parent.mkdir(parents=True, exist_ok=True)
    lockfile.write_text(str(os.getpid()))
    return lockfile


def _release_lockfile(lockfile: pathlib.Path) -> None:
    try:
        lockfile.unlink(missing_ok=True)
    except OSError:
        pass


def main() -> None:
    lockfile = _acquire_lockfile()

    atexit.register(_release_lockfile, lockfile)

    def _sigterm_handler(signum: int, frame: object) -> None:
        _release_lockfile(lockfile)
        sys.exit(0)

    signal.signal(signal.SIGTERM, _sigterm_handler)

    uvicorn.run(app, host='127.0.0.1', port=SIDECAR_PORT, log_level='info')


if __name__ == '__main__':
    main()
