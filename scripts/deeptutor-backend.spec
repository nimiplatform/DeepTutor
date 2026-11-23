# The backend is an App-owned process. Optional AI/engine dependencies are
# installed only when selected; the frozen entry uses the same Python services.
from pathlib import Path
import site
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

root = Path(SPECPATH).parent
dist_infos = [
    (str(info), info.name)
    for site_dir in site.getsitepackages()
    if Path(site_dir).is_dir()
    for info in Path(site_dir).glob("*.dist-info")
]
# PyInstaller's collect_submodules skips PEP 420 namespace directories without
# __init__.py (such as deeptutor/agents/research). Enumerate every Python module
# under deeptutor/ explicitly so dynamic importlib lookups succeed in frozen builds.
namespace_modules = []
for py_file in sorted((root / "deeptutor").rglob("*.py")):
    if "__pycache__" in py_file.parts:
        continue
    rel = py_file.relative_to(root).with_suffix("")
    parts = rel.parts[:-1] if rel.name == "__init__" else rel.parts
    if parts:
        namespace_modules.append(".".join(parts))

analysis = Analysis(
    [str(root / "deeptutor/nimi/worker.py")],
    pathex=[str(root)],
    datas=collect_data_files("deeptutor") + dist_infos,
    # tiktoken discovers encoding constructors through a namespace package.
    # Static import analysis misses these plugins, breaking packaged KB indexing.
    hiddenimports=sorted(set(
        collect_submodules("deeptutor")
        + namespace_modules
        + collect_submodules("uvicorn")
        + collect_submodules("tiktoken_ext")
    )),
)
archive = PYZ(analysis.pure)
executable = EXE(archive, analysis.scripts, [], exclude_binaries=True,
                 name="deeptutor-backend", console=True)
collection = COLLECT(executable, analysis.binaries, analysis.datas,
                     name="deeptutor-backend")
