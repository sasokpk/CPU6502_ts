from pathlib import Path

from assembler import run_program


def main() -> None:
    root = Path(__file__).resolve().parent
    program_path = root / "prog.cpu"
    source = program_path.read_text(encoding="utf-8")

    result = run_program(source)

    result_path = root.parent / "result.txt"
    with result_path.open("w", encoding="utf-8") as handle:
        handle.write("Program bytes:\n")
        handle.write(" ".join(f"{b:02X}" for b in result["program"]))
        handle.write("\n\n")

        for step in result["trace"]:
            handle.write(f"Step {step['step']} opcode={step['opcode']:02X}\n")
            if "after" in step:
                handle.write(f"  Before: {step['before']}\n")
                handle.write(f"  After:  {step['after']}\n")
            if "error" in step:
                handle.write(f"  Error:  {step['error']}\n")
            handle.write("\n")

        handle.write(f"Halted: {result['halted']}\n")
        handle.write(f"Error: {result['error']}\n")
        handle.write(f"Outputs: {result['outputs']}\n")
        handle.write(f"Final state: {result['final_state']}\n")


if __name__ == "__main__":
    main()
