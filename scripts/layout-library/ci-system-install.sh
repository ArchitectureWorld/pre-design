#!/usr/bin/env bash
# Disposable CI runner only. Fail closed on incomplete indexes or missing tools.
set -euo pipefail
set -x
APT_OPTIONS=(-o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 -o Acquire::Retries=2 -o DPkg::Lock::Timeout=30)
timeout --kill-after=15s 180s sudo apt-get "${APT_OPTIONS[@]}" -o APT::Update::Error-Mode=any update
timeout --kill-after=15s 480s sudo apt-get "${APT_OPTIONS[@]}" install -y poppler-utils fonts-noto-cjk libreoffice-impress libreoffice-writer python3
timeout --kill-after=15s 60s fc-cache -f
fc-match 'Noto Sans CJK SC'
command -v pdftotext
