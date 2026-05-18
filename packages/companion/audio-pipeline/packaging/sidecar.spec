# PyInstaller spec for the frozen Strong Tower Mods companion sidecar.
#
# Usage:
#
#   cd packages/companion/audio-pipeline
#   uv run pyinstaller --noconfirm --distpath dist-frozen \
#       --workpath build-frozen packaging/sidecar.spec
#
# Output: dist-frozen/sidecar.exe (~51 MB, single-file).
#
# This spec is generated once and then committed; regenerating it from
# CLI flags would lose the hand-curated `hiddenimports` list below.
# When a new module/package is added that PyInstaller cannot detect
# statically (anything imported via importlib, lazy-loaded inside a
# function, or pulled in through a plugin registry), add it to the
# appropriate section here and re-build.

# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules
from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []

# audio_pipeline.* — listed explicitly because PyInstaller's static
# analysis traces imports from the entry point and would miss any
# module that is only ever loaded lazily inside a function (e.g.,
# `from mempalace.layers import MemoryStack` inside memory.recall).
hiddenimports = [
    'audio_pipeline',
    'audio_pipeline.main',
    'audio_pipeline.server',
    'audio_pipeline.cloud_client',
    'audio_pipeline.memory',
    'audio_pipeline.voice',
    'audio_pipeline.voice.elevenlabs',
    'audio_pipeline.voice.packaging',
    'audio_pipeline.voice.pipeline',
]

# Frameworks that register plugins / dispatch by string name. Without
# collect_submodules, PyInstaller would only pull in the symbols we
# import by name, and runtime dispatch (uvicorn loop loader, fastapi
# response codecs, pydantic validators, websockets compression) would
# fail with cryptic ModuleNotFoundError at first request.
hiddenimports += collect_submodules('fastapi')
hiddenimports += collect_submodules('uvicorn')
hiddenimports += collect_submodules('websockets')
hiddenimports += collect_submodules('httpx')
hiddenimports += collect_submodules('pydantic')

# mempalace ships a Chroma backend with C extension libraries and
# YAML data files (instruction templates, i18n strings) that
# collect_submodules alone would not bundle. collect_all sweeps
# everything: hidden submodules, package data, and binary deps.
tmp_ret = collect_all('mempalace')
datas += tmp_ret[0]
binaries += tmp_ret[1]
hiddenimports += tmp_ret[2]


a = Analysis(
    ['sidecar_entry.py'],
    pathex=['src'],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='sidecar',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
