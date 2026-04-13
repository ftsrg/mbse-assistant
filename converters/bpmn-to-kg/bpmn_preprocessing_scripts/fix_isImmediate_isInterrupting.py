from pathlib import Path
import re
import sys


# Attributes that incorrectly appear as boolean flags
BOOLEAN_ATTRS = [
    "isInterrupting",
    "isImmediate",
]


def fix_boolean_attributes(text: str) -> str:
    for attr in BOOLEAN_ATTRS:
        # Only replace cases where the attribute name is followed by whitespace,
        # and is NOT followed by '='
        pattern = rf'(\s){attr}(?=\s)(?!\s*=)'
        replacement = rf'\1{attr}="true"'
        text = re.sub(pattern, replacement, text)
    return text


def main():
    # Expected usage:
    # python scripts/fix_isImmediate_isInterrupting_param.py <input_dir>
    if len(sys.argv) != 2:
        print("Usage:")
        print("python scripts/fix_isImmediate_isInterrupting_param.py <input_dir>")
        sys.exit(1)

    input_dir = Path(sys.argv[1])

    if not input_dir.exists():
        print(f"Error: input directory does not exist: {input_dir}")
        sys.exit(1)

    if not input_dir.is_dir():
        print(f"Error: input path is not a directory: {input_dir}")
        sys.exit(1)

    changed_files = []

    for file_path in input_dir.glob("*.bpmn"):
        original = file_path.read_text(encoding="utf-8")
        fixed = fix_boolean_attributes(original)

        if fixed != original:
            file_path.write_text(fixed, encoding="utf-8")
            changed_files.append(file_path.name)

    print(f"Number of fixed files: {len(changed_files)}")
    for name in changed_files:
        print(name)


if __name__ == "__main__":
    main()
