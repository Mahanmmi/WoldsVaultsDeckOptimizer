# WoldsVaultsDeckOptimizer
Script that computes the best deck layouts for Wold's Vaults based on a simulated-annealing optimizer. The main simulation logic is written in Rust, and data handling is done in Python. The output is a .xlsx file containing a full breakdown of the decks and their optimal solutions. The main Python code in NDM_Optimizer_Rust.py contains instructions on how to configure the parameters in the script for testing and performance. 

You will need to install Rust and compile the simulation core before the script can be run. This process looks like:

1. Go to https://rustup.rs and follow the instructions for your OS. Accept all defaults.
2. Install maturin and openpyxl: `pip install maturin openpyxl`
3. Compile the code (might take a bit, but drastically reduces simulation runtime. You don't need to recompile when altering parameters, only if you actually change the optimizer logic in lib.rs):

**Windows (PowerShell):**
```
cd ndm_core
python -m maturin build --release
pip install .\target\wheels\ndm_core-0.1.0-cp311-cp311-win_amd64.whl --force-reinstall
```

**Mac/Linux:**
```
cd ndm_core
python -m maturin build --release
pip install target/wheels/ndm_core-0.1.0-*.whl --force-reinstall
```

The exact filename in the `wheels/` folder may differ slightly depending on your Python version and OS — use whatever `.whl` file appears there.

4. Run the script: `python NDM_Optimizer_Rust.py`

If the Rust extension fails to import, the script will fall back to pure Python automatically and print a warning. Everything will still work, just slower.
