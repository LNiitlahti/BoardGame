import os
import sys

# Modules under test (hexmath.py, colors.py, state.py, ...) live one directory
# up from tests/, as flat sibling modules with no package/setup.py — this puts
# that directory on sys.path so `import hexmath` etc. works from any test file.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
