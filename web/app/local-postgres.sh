#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd "$(dirname "$0")/../.." && pwd -P)
postgres_root="$project_root/.cache/postgres"
postgres_data="$project_root/.local/web/postgres-data"
postgres_socket="/tmp/pre-design-pg-$(id -u)"
postgres_bin="$postgres_root/usr/lib/postgresql/16/bin"
export LD_LIBRARY_PATH="$postgres_root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
if [[ ! -x "$postgres_bin/postgres" ]]; then
  mkdir -p "$project_root/.cache/postgres-download" "$postgres_root"
  cd "$project_root/.cache/postgres-download"
  apt-get download postgresql-16 postgresql-client-16 libpq5
  for archive in *.deb; do dpkg-deb -x "$archive" "$postgres_root"; done
fi
mkdir -p "$project_root/.local/web"
if [[ ! -d "$postgres_data" ]]; then "$postgres_bin/initdb" -D "$postgres_data" -A trust --no-locale --encoding=UTF8; fi
if [[ -L "$postgres_socket" ]]; then echo 'Unsafe PostgreSQL socket directory' >&2; exit 1; fi
mkdir -p -m 700 "$postgres_socket"
[[ $(stat -c %u "$postgres_socket") == "$(id -u)" ]] || exit 1
chmod 700 "$postgres_socket"
case "${1:-start}" in
start)
  if ! "$postgres_bin/pg_ctl" -D "$postgres_data" status >/dev/null 2>&1; then
    "$postgres_bin/pg_ctl" -D "$postgres_data" -l "$project_root/.local/web/postgres.log" -o "-h '' -p 55439 -k $postgres_socket" start
  fi
  if [[ $("$postgres_bin/psql" -h "$postgres_socket" -p 55439 -d postgres -Atc "SELECT count(*) FROM pg_database WHERE datname='pre_design_web'") == 0 ]]; then
    "$postgres_bin/createdb" -h "$postgres_socket" -p 55439 pre_design_web
  fi
  ;;
stop) "$postgres_bin/pg_ctl" -D "$postgres_data" stop -m fast;;
status) "$postgres_bin/pg_ctl" -D "$postgres_data" status;;
*) echo 'Usage: local-postgres.sh start|stop|status' >&2;exit 1;;
esac
