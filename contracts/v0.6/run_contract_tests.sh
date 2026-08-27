#!/usr/bin/env bash
set -euo pipefail
python "$(dirname "$0")/tests/test_contracts.py"
