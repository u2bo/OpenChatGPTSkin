#!/usr/bin/env sh
set -eu

if [ "$#" -lt 4 ] || [ "$#" -gt 6 ]; then
  echo "Usage: $0 <executable> <background> <theme-directory> <archive> [unpack-directory] [patch]" >&2
  exit 2
fi

executable=$1
background=$2
theme_dir=$3
archive=$4
unpack_dir=${5:-"${theme_dir}-unpacked"}
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
patch=${6:-"${script_dir}/theme-patch.json"}

for required_file in "$executable" "$background" "$patch"; do
  if [ ! -f "$required_file" ]; then
    echo "Required file does not exist: $required_file" >&2
    exit 2
  fi
done
for target in "$theme_dir" "$archive" "$unpack_dir"; do
  if [ -e "$target" ]; then
    echo "Refusing to overwrite an existing target: $target" >&2
    exit 2
  fi
done

"$executable" theme contract
"$executable" theme create --dir "$theme_dir" --id agent-demo --name "Agent Demo" --author "Theme Agent" --appearance dark --background "$background"
"$executable" theme config --dir "$theme_dir" --patch "$patch"
"$executable" theme show --dir "$theme_dir"
"$executable" theme validate --dir "$theme_dir"
"$executable" theme pack --dir "$theme_dir" --out "$archive"
"$executable" theme unpack --file "$archive" --out "$unpack_dir"
"$executable" theme validate --dir "$unpack_dir"

printf '%s\n' "Theme project: $theme_dir" "Archive: $archive" "Unpacked project: $unpack_dir"
