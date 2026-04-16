from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

from CPU import CPU6502, InputRequired


OPCODES = {
    "LDA": 0xA9,
    "LDX": 0xA2,
    "LDY": 0xA0,
    "ADC": 0x69,
    "SBC": 0xE9,
    "CMP": 0xC9,
    "CPX": 0xE0,
    "AND": 0x29,
    "ORA": 0x09,
    "CLA": 0x11,
    "STAL": 0x12,
    "LSAL": 0x13,
    "OTTL": 0x15,
    "MULL": 0x16,
    "EOR": 0x49,
    "NOP": 0xEA,
    "BRK": 0x00,
    "TAX": 0xAA,
    "BNE": 0xD0,
    "BEQ": 0xF0,
    "BCC": 0x90,
    "BCS": 0xB0,
    "BMI": 0x30,
    "BPL": 0x10,
    "BVS": 0x70,
    "BVC": 0x50,
    "CLC": 0x18,
    "JMP": 0x4C,
    "MUL": 0x07,
    "MULM": 0x14,
    "CMPC": 0xCD,
    "APA": 0x17,
    "STA": 0x01,
    "LSA": 0x02,
    "STX": 0x03,
    "LSX": 0x04,
    "CTA": 0x05,
    "OTT": 0x06,
    "XTA": 0x08,
}

NO_ARG = {"BRK", "NOP", "XTA", "CLC", "CTA", "TAX", "CLA"}
ABSOLUTE_ADDR = {"JMP"}
IMM16_OPS = {"LDA", "LDX", "LDY", "ADC", "SBC", "CMP", "CPX", "AND", "ORA", "EOR"}
BRANCH_OPS = {"BNE", "BEQ", "BCC", "BCS", "BMI", "BPL", "BVS", "BVC"}


def _instruction_size(op: str) -> int:
    if op in NO_ARG:
        return 1
    if op in IMM16_OPS or op in ABSOLUTE_ADDR:
        return 3
    return 2


def _parse_number(token: str) -> int:
    return int(token, 16)


def _parse_source(source: str) -> list[dict[str, Any]]:
    statements: list[dict[str, Any]] = []

    for raw_line in source.splitlines():
        line = raw_line.split(";", 1)[0].split("#", 1)[0].strip()
        if not line:
            continue

        if ":" in line:
            head, tail = line.split(":", 1)
            label = head.strip()
            if label:
                statements.append({"type": "label", "value": label})
            line = tail.strip()
            if not line:
                continue

        parts = line.split()
        op = parts[0].upper()
        arg = parts[1] if len(parts) > 1 else None
        if len(parts) > 2:
            raise ValueError(f"Too many tokens in line: '{raw_line}'")

        if op in OPCODES:
            statements.append({"type": "instruction", "op": op, "arg": arg})
        else:
            statements.append({"type": "byte", "value": op})

    return statements


def assemble_source(source: str) -> list[int]:
    statements = _parse_source(source)
    labels: dict[str, int] = {}
    addr = 0

    for statement in statements:
        if statement["type"] == "label":
            labels[statement["value"]] = addr
            continue
        if statement["type"] == "instruction":
            addr += _instruction_size(statement["op"])
            continue
        addr += 1

    program: list[int] = []
    addr = 0

    for statement in statements:
        if statement["type"] == "label":
            continue

        if statement["type"] == "instruction":
            op = statement["op"]
            arg = statement["arg"]
            program.append(OPCODES[op])
            addr += 1

            if op in NO_ARG:
                continue

            if arg is None:
                raise ValueError(f"Instruction '{op}' expects an argument")

            if arg in labels:
                target = labels[arg]
                if op in BRANCH_OPS:
                    offset = target - (addr + 1)
                    if offset < -128 or offset > 127:
                        raise ValueError(f"Branch offset out of range for '{op} {arg}': {offset}")
                    program.append(offset & 0xFF)
                    addr += 1
                elif op in ABSOLUTE_ADDR or op in IMM16_OPS:
                    program.append(target & 0xFF)
                    program.append((target >> 8) & 0xFF)
                    addr += 2
                else:
                    program.append(target & 0xFF)
                    addr += 1
                continue

            value = _parse_number(arg)
            if op in ABSOLUTE_ADDR or op in IMM16_OPS:
                program.append(value & 0xFF)
                program.append((value >> 8) & 0xFF)
                addr += 2
            else:
                program.append(value & 0xFF)
                addr += 1
            continue

        value = _parse_number(statement["value"])
        program.append(value & 0xFF)
        addr += 1

    return program


def run_program(source: str, max_steps: int = 1000, inputs: list[int] | None = None) -> dict[str, Any]:
    session = create_session(source=source, max_steps=max_steps)
    if inputs:
        session.input_values.extend(int(value) for value in inputs)
    session.execute_until_pause()
    return session.to_response()


@dataclass
class ProgramSession:
    source: str
    max_steps: int
    program: list[int]
    cpu: CPU6502
    session_id: str = field(default_factory=lambda: uuid4().hex)
    input_values: list[int] = field(default_factory=list)
    outputs: list[dict[str, int]] = field(default_factory=list)
    trace: list[dict[str, Any]] = field(default_factory=list)
    occupied_addresses: set[int] = field(default_factory=set)
    halted: bool = False
    waiting_input: bool = False
    error: str | None = None
    steps_executed: int = 0

    def snapshot_occupied_memory(self) -> list[dict[str, int]]:
        return [
            {"address": addr & 0xFFFF, "value": self.cpu.memory[addr] & 0xFF}
            for addr in sorted(self.occupied_addresses)
        ]

    def provide_input(self, value: int) -> None:
        self.input_values.append(int(value) & CPU6502.MASK32)
        self.waiting_input = False

    def execute_until_pause(self) -> None:
        while self.steps_executed < self.max_steps and not self.halted and not self.error:
            before = self.cpu.snapshot()
            op = self.cpu.memory[self.cpu._PC]

            if op == 0x05 and not self.input_values:
                self.waiting_input = True
                break

            if op in {0x01, 0x03, 0x14}:
                target = self.cpu.memory[(self.cpu._PC + 1) & 0xFFFF]
                self.occupied_addresses.add(target & 0xFFFF)
                self.occupied_addresses.add((target + 1) & 0xFFFF)
            elif op == 0x12:
                target = self.cpu.memory[(self.cpu._PC + 1) & 0xFFFF]
                for offset in range(4):
                    self.occupied_addresses.add((target + offset) & 0xFFFF)

            try:
                cont = self.cpu.execute_instructions()
            except InputRequired:
                self.waiting_input = True
                break
            except Exception as exc:  # noqa: BLE001
                self.error = str(exc)
                self.trace.append(
                    {
                        "step": self.steps_executed + 1,
                        "opcode": op,
                        "before": before,
                        "error": self.error,
                        "memory_used": self.snapshot_occupied_memory(),
                    }
                )
                break

            self.steps_executed += 1
            after = self.cpu.snapshot()
            self.trace.append(
                {
                    "step": self.steps_executed,
                    "opcode": op,
                    "before": before,
                    "after": after,
                    "halted": not cont,
                    "memory_used": self.snapshot_occupied_memory(),
                }
            )

            if not cont:
                self.halted = True
                break

        if self.steps_executed >= self.max_steps and not self.halted and not self.waiting_input and not self.error:
            self.error = f"Exceeded max_steps={self.max_steps}"

    def to_response(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "program": self.program,
            "trace": self.trace,
            "halted": self.halted,
            "waiting_input": self.waiting_input,
            "error": self.error,
            "outputs": self.outputs,
            "final_state": self.cpu.snapshot(),
        }


def create_session(source: str, max_steps: int = 1000) -> ProgramSession:
    program = assemble_source(source)
    outputs: list[dict[str, int]] = []
    input_values: list[int] = []

    def input_provider() -> int | None:
        if input_values:
            return input_values.pop(0)
        return None

    def output_handler(value: int, addr: int) -> None:
        outputs.append({"value": value & CPU6502.MASK32, "address": addr & 0xFFFF})

    cpu = CPU6502(input_provider=input_provider, output_handler=output_handler)
    for index, byte in enumerate(program):
        cpu.memory[index] = byte & 0xFF
    cpu._PC = 0x0000

    return ProgramSession(
        source=source,
        max_steps=max_steps,
        program=program,
        cpu=cpu,
        input_values=input_values,
        outputs=outputs,
    )
