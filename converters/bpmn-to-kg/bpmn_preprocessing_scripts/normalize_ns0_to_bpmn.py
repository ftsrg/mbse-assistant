from pathlib import Path
import sys


# Function:
#    - checks the .bpmn files located directly in the input directory
#    - if it finds the BPMN namespace using the ns0 prefix,
#      it rewrites it to the bpmn prefix
#    - saves the result into the specified output directory


# This is the BPMN namespace URI.
# At the beginning of the file, we usually look for something like:
# xmlns:ns0="http://www.omg.org/spec/BPMN/20100524/MODEL"
BPMN_NAMESPACE = "http://www.omg.org/spec/BPMN/20100524/MODEL"


def normalize_one_file(input_file: Path, output_file: Path):
    """
    Processes a single .bpmn file.

    What does it do?
    1. Reads the file as text.
    2. Checks whether it contains the BPMN namespace with the ns0 prefix.
    3. If yes:
       - xmlns:ns0 -> xmlns:bpmn
       - ns0: -> bpmn:
    4. Writes the result to the output file.
    """

    # Read the whole file as text.
    text = input_file.read_text(encoding="utf-8")

    # This is the exact namespace declaration we are looking for.
    old_namespace_declaration = f'xmlns:ns0="{BPMN_NAMESPACE}"'

    # This is what we want to replace it with.
    new_namespace_declaration = f'xmlns:bpmn="{BPMN_NAMESPACE}"'

    # Check whether this exact ns0 declaration is present in the file.
    has_bpmn_ns0 = old_namespace_declaration in text

    if has_bpmn_ns0:
        # 1) Rewrite the namespace declaration:
        # xmlns:ns0="..."  ->  xmlns:bpmn="..."
        text = text.replace(old_namespace_declaration, new_namespace_declaration)

        # 2) Rewrite every ns0: prefix to bpmn:
        # e.g. <ns0:process> -> <bpmn:process>
        text = text.replace("ns0:", "bpmn:")

        print(f"[OK] normalized: {input_file}")
    else:
        # If the file does not contain this namespace declaration,
        # do not modify it, just report it.
        print(f"[SKIP] no BPMN ns0 namespace found, copied unchanged: {input_file}")

    # Create the target directory if it does not already exist.
    output_file.parent.mkdir(parents=True, exist_ok=True)

    # Write the new or unchanged content.
    output_file.write_text(text, encoding="utf-8")


def process_directory(input_dir: Path, output_dir: Path):
    """
    Iterates over the .bpmn files found directly in the input directory
    and processes each of them.
    """

    # Iterate through the direct contents of the input directory.
    for input_file in input_dir.iterdir():

        # We only want regular files with the .bpmn extension.
        if input_file.is_file() and input_file.suffix == ".bpmn":

            # The output file will be created in the output directory
            # with the same filename.
            output_file = output_dir / input_file.name

            # Process the current file.
            normalize_one_file(input_file, output_file)


def main():
    """
    Entry point of the program.
    Script execution starts here.
    """

    # Expected usage:
    # python normalize_ns0_to_bpmn.py <input_dir> <output_dir>
    if len(sys.argv) != 3:
        print("Usage:")
        print("python normalize_ns0_to_bpmn.py <input_dir> <output_dir>")
        sys.exit(1)

    # Read command-line arguments
    input_dir = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])

    # Check whether the input directory exists
    if not input_dir.exists():
        print(f"Error: input directory does not exist: {input_dir}")
        sys.exit(1)

    if not input_dir.is_dir():
        print(f"Error: input path is not a directory: {input_dir}")
        sys.exit(1)

    # Process all .bpmn files
    process_directory(input_dir, output_dir)

    print("\nDone.")


# This ensures that main() only runs
# when the file is executed directly.
if __name__ == "__main__":
    main()
