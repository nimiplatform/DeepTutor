# The backend is an App-owned process. Optional AI/engine dependencies are
# installed only when selected; the frozen entry uses the same Python services.
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

root = Path(SPECPATH).parent
analysis = Analysis(
    [str(root / "deeptutor/nimi/worker.py")],
    pathex=[str(root)],
    datas=collect_data_files("deeptutor"),
    # tiktoken discovers encoding constructors through a namespace package.
    # Static import analysis misses these plugins, breaking packaged KB indexing.
    hiddenimports=(collect_submodules("deeptutor") + collect_submodules("uvicorn")
                   + collect_submodules("tiktoken_ext")),
)
archive = PYZ(analysis.pure)
executable = EXE(archive, analysis.scripts, [], exclude_binaries=True,
                 name="deeptutor-backend", console=True)
collection = COLLECT(executable, analysis.binaries, analysis.datas,
                     name="deeptutor-backend")
