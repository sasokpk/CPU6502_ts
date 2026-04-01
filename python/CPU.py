from typing import Final


class InputRequired(Exception):
    pass


class CPU6502:
    MASK16: Final = 0xFFFF
    MASK32: Final = 0xFFFFFFFF

    CARRY: Final = 0x01
    ZERO: Final = 0x02
    IRQ: Final = 0x04
    DECIMAL: Final = 0x08
    BRK: Final = 0x10
    OVERFLOW: Final = 0x40
    NEGATIVE: Final = 0x80

    def __init__(self, input_provider=None, output_handler=None):
        self._A = 0x0000
        self._X = 0x0000
        self._Y = 0x0000
        self._SP = 0xFD
        self._PC = 0x0000
        self._P = 0b0010_0000
        self.memory = [0x00] * 65536
        self.cycles = 0
        self._input_provider = input_provider or self._default_input_provider
        self._output_handler = output_handler or self._default_output_handler

    def _default_input_provider(self):
        return int(input("Введите число в hex для загрузки в A: "), 16)

    def _default_output_handler(self, value, _addr):
        width = 8 if value > self.MASK16 else 4
        print(f"Output to console: {value:0{width}X}| {int(value)}")

    @property
    def C(self):
        return (self._P & self.CARRY) != 0

    @C.setter
    def C(self, value):
        self._P = (self._P | self.CARRY) if value else (self._P & ~self.CARRY)

    @property
    def Z(self):
        return (self._P & self.ZERO) != 0

    @Z.setter
    def Z(self, value):
        self._P = (self._P | self.ZERO) if value else (self._P & ~self.ZERO)

    @property
    def I(self):
        return (self._P & self.IRQ) != 0

    @I.setter
    def I(self, value):
        self._P = (self._P | self.IRQ) if value else (self._P & ~self.IRQ)

    @property
    def D(self):
        return (self._P & self.DECIMAL) != 0

    @D.setter
    def D(self, value):
        self._P = (self._P | self.DECIMAL) if value else (self._P & ~self.DECIMAL)

    @property
    def B(self):
        return (self._P & self.BRK) != 0

    @B.setter
    def B(self, value):
        self._P = (self._P | self.BRK) if value else (self._P & ~self.BRK)

    @property
    def V(self):
        return (self._P & self.OVERFLOW) != 0

    @V.setter
    def V(self, value):
        self._P = (self._P | self.OVERFLOW) if value else (self._P & ~self.OVERFLOW)

    @property
    def N(self):
        return (self._P & self.NEGATIVE) != 0

    @N.setter
    def N(self, value):
        self._P = (self._P | self.NEGATIVE) if value else (self._P & ~self.NEGATIVE)

    def update_zn_flags(self, value, bits: int = 16):
        mask = (1 << bits) - 1
        sign_bit = 1 << (bits - 1)
        self.Z = (value & mask) == 0
        self.N = (value & sign_bit) != 0

    def branch(self, condition):
        offset = self.memory[self._PC]
        self._PC += 1
        if offset >= 0x80:
            offset -= 0x100
        if condition:
            self._PC = (self._PC + offset) & 0xFFFF
            self.cycles += 3
        else:
            self.cycles += 2

    def _read16(self, addr: int) -> int:
        low = self.memory[addr & 0xFFFF]
        high = self.memory[(addr + 1) & 0xFFFF]
        return ((high << 8) | low) & self.MASK16

    def _write16(self, addr: int, value: int) -> None:
        addr &= 0xFFFF
        value &= self.MASK16
        self.memory[addr] = value & 0xFF
        self.memory[(addr + 1) & 0xFFFF] = (value >> 8) & 0xFF

    def _read32(self, addr: int) -> int:
        addr &= 0xFFFF
        return (
            self.memory[addr]
            | (self.memory[(addr + 1) & 0xFFFF] << 8)
            | (self.memory[(addr + 2) & 0xFFFF] << 16)
            | (self.memory[(addr + 3) & 0xFFFF] << 24)
        ) & self.MASK32

    def _write32(self, addr: int, value: int) -> None:
        addr &= 0xFFFF
        value &= self.MASK32
        self.memory[addr] = value & 0xFF
        self.memory[(addr + 1) & 0xFFFF] = (value >> 8) & 0xFF
        self.memory[(addr + 2) & 0xFFFF] = (value >> 16) & 0xFF
        self.memory[(addr + 3) & 0xFFFF] = (value >> 24) & 0xFF

    def __str__(self):
        flags = (
            f"[{'C' if self.C else '-'}"
            f"{'Z' if self.Z else '-'}"
            f"{'I' if self.I else '-'}"
            f"{'D' if self.D else '-'}"
            f"{'B' if self.B else '-'}"
            f" - "
            f"{'V' if self.V else '-'}"
            f"{'N' if self.N else '-'}]"
        )
        return (
            f"PC:${self._PC:04X}  A:${self._A:08X}  X:${self._X:08X}  Y:${self._Y:08X}  "
            f"SP:${self._SP:02X}  P:${self._P:02X}  {flags}  cycles:{self.cycles}"
        )

    def snapshot(self):
        return {
            "PC": self._PC & 0xFFFF,
            "A": self._A & self.MASK32,
            "X": self._X & self.MASK32,
            "Y": self._Y & self.MASK32,
            "SP": self._SP & 0xFF,
            "P": self._P & 0xFF,
            "cycles": self.cycles,
            "flags": {
                "C": self.C,
                "Z": self.Z,
                "I": self.I,
                "D": self.D,
                "B": self.B,
                "V": self.V,
                "N": self.N,
            },
        }

    def LDA(self, value):
        self._A = value & self.MASK16
        self.update_zn_flags(self._A)
        self.cycles += 2

    def LDX(self, value):
        self._X = value & self.MASK16
        self.update_zn_flags(self._X)
        self.cycles += 2

    def LDY(self, value):
        self._Y = value & self.MASK16
        self.update_zn_flags(self._Y)
        self.cycles += 2

    def ADC(self, value):
        total = self._A + value + (1 if self.C else 0)
        result = total & self.MASK16
        self.V = ((self._A ^ result) & (value ^ result) & 0x8000) != 0
        self.C = total > self.MASK16
        self._A = result
        self.update_zn_flags(self._A)
        self.cycles += 2

    def SBC(self, value):
        total = self._A - value - (0 if self.C else 1)
        result = total & self.MASK16
        self.V = ((self._A ^ result) & ((~value) ^ result) & 0x8000) != 0
        self.C = total >= 0
        self._A = result
        self.update_zn_flags(self._A)
        self.cycles += 2

    def CMP(self, value):
        diff = self._A - value
        self.update_zn_flags(diff & self.MASK16)
        self.C = self._A >= value
        self.cycles += 2

    def CMPC(self, addr):
        value = self._read16(addr)
        diff = self._A - value
        self.update_zn_flags(diff & self.MASK16)
        self.C = self._A >= value
        self.cycles += 4

    def CPX(self, value):
        diff = self._X - value
        self.update_zn_flags(diff & self.MASK16)
        self.C = self._X >= value
        self.cycles += 2

    def AND(self, value):
        self._A &= value
        self.update_zn_flags(self._A)
        self.cycles += 2

    def ORA(self, value):
        self._A |= value
        self.update_zn_flags(self._A)
        self.cycles += 2

    def EOR(self, value):
        self._A ^= value
        self.update_zn_flags(self._A)
        self.cycles += 2

    def TAX(self):
        self._X = self._A & self.MASK32
        self.update_zn_flags(self._X)
        self.cycles += 2

    def XTA(self):
        self._A = self._X & self.MASK32
        self.update_zn_flags(self._A)
        self.cycles += 2

    def CLC(self):
        self.C = False
        self.cycles += 1

    def NOP(self):
        self.cycles += 2

    def A_to_store(self, addr):
        self._write16(addr, self._A)
        self.cycles += 4

    def A_to_store_long(self, addr):
        self._write32(addr, self._A)
        self.cycles += 6

    def from_store_to_A(self, addr):
        self._A = self._read16(addr)
        self.update_zn_flags(self._A)
        self.cycles += 4

    def from_store_long_to_A(self, addr):
        self._A = self._read32(addr)
        self.update_zn_flags(self._A, bits=32)
        self.cycles += 6

    def X_to_store(self, addr):
        self._write16(addr, self._X)
        self.cycles += 4

    def clear_all_flags(self):
        self.C = False
        self.Z = False
        self.I = False
        self.D = False
        self.B = False
        self.V = False
        self.N = False

    def from_store_to_X(self, addr):
        self._X = self._read16(addr)
        self.update_zn_flags(self._X)
        self.cycles += 4

    def Output_to_console(self, addr):
        value = self._read16(addr)
        self._output_handler(value, addr)
        self.cycles += 4

    def Output_long_to_console(self, addr):
        value = self._read32(addr)
        self._output_handler(value, addr)
        self.cycles += 6

    def from_console_to_A(self):
        value = self._input_provider()
        if value is None:
            raise InputRequired("Input required")
        self._A = int(value) & self.MASK32
        self.update_zn_flags(self._A, bits=32)
        self.cycles += 2

    def MUL(self, addr):
        value = self._read16(addr)
        self._A = (self._A * value) & self.MASK32
        self.update_zn_flags(self._A, bits=32)
        self.cycles += 4

    def MULL(self, addr):
        value = self._read32(addr)
        self._A = (self._A * value) & self.MASK32
        self.update_zn_flags(self._A, bits=32)
        self.cycles += 6

    def MULM(self, addr):
        value = self._read16(addr)
        result = (self._A * value) & self.MASK16
        self._write16(addr, result)
        self.update_zn_flags(result)
        self.cycles += 6

    def execute_instructions(self):
        op = self.memory[self._PC]
        self._PC += 1

        if op == 0x00:
            return False
        elif op == 0x01:
            addr = self.memory[self._PC]
            self._PC += 1
            self.A_to_store(addr)
        elif op == 0x02:
            addr = self.memory[self._PC]
            self._PC += 1
            self.from_store_to_A(addr)
        elif op == 0x03:
            addr = self.memory[self._PC]
            self._PC += 1
            self.X_to_store(addr)
        elif op == 0x04:
            addr = self.memory[self._PC]
            self._PC += 1
            self.from_store_to_X(addr)
        elif op == 0x05:
            self.from_console_to_A()
        elif op == 0x06:
            addr = self.memory[self._PC]
            self._PC += 1
            self.Output_to_console(addr)
        elif op == 0x07:
            addr = self.memory[self._PC]
            self._PC += 1
            self.MUL(addr)
        elif op == 0x08:
            self.XTA()
        elif op == 0x09:
            value = self.memory[self._PC] | (self.memory[self._PC + 1] << 8)
            self._PC += 2
            self.ORA(value)
        elif op == 0x10:
            self.branch(not self.N)
        elif op == 0x11:
            self.clear_all_flags()
        elif op == 0x12:
            addr = self.memory[self._PC]
            self._PC += 1
            self.A_to_store_long(addr)
        elif op == 0x13:
            addr = self.memory[self._PC]
            self._PC += 1
            self.from_store_long_to_A(addr)
        elif op == 0x14:
            addr = self.memory[self._PC]
            self._PC += 1
            self.MULM(addr)
        elif op == 0x15:
            addr = self.memory[self._PC]
            self._PC += 1
            self.Output_long_to_console(addr)
        elif op == 0x16:
            addr = self.memory[self._PC]
            self._PC += 1
            self.MULL(addr)
        elif op == 0x18:
            self.CLC()
        elif op == 0x29:
            value = self.memory[self._PC] | (self.memory[self._PC + 1] << 8)
            self._PC += 2
            self.AND(value)
        elif op == 0x30:
            self.branch(self.N)
        elif op == 0x49:
            value = self.memory[self._PC] | (self.memory[self._PC + 1] << 8)
            self._PC += 2
            self.EOR(value)
        elif op == 0x4C:
            low = self.memory[self._PC]
            high = self.memory[self._PC + 1]
            self._PC = (high << 8) | low
            self.cycles += 3
        elif op == 0x50:
            self.branch(not self.V)
        elif op == 0x69:
            value = self.memory[self._PC] | (self.memory[self._PC + 1] << 8)
            self._PC += 2
            self.ADC(value)
        elif op == 0x70:
            self.branch(self.V)
        elif op == 0x90:
            self.branch(not self.C)
        elif op == 0xA0:
            value = self.memory[self._PC] | (self.memory[self._PC + 1] << 8)
            self._PC += 2
            self.LDY(value)
        elif op == 0xA2:
            value = self.memory[self._PC] | (self.memory[self._PC + 1] << 8)
            self._PC += 2
            self.LDX(value)
        elif op == 0xA9:
            value = self.memory[self._PC] | (self.memory[self._PC + 1] << 8)
            self._PC += 2
            self.LDA(value)
        elif op == 0xAA:
            self.TAX()
        elif op == 0xB0:
            self.branch(self.C)
        elif op == 0xC9:
            value = self.memory[self._PC] | (self.memory[self._PC + 1] << 8)
            self._PC += 2
            self.CMP(value)
        elif op == 0xCD:
            addr = self.memory[self._PC]
            self._PC += 1
            self.CMPC(addr)
        elif op == 0xD0:
            self.branch(not self.Z)
        elif op == 0xE0:
            value = self.memory[self._PC] | (self.memory[self._PC + 1] << 8)
            self._PC += 2
            self.CPX(value)
        elif op == 0xE9:
            value = self.memory[self._PC] | (self.memory[self._PC + 1] << 8)
            self._PC += 2
            self.SBC(value)
        elif op == 0xEA:
            self.NOP()
        elif op == 0xF0:
            self.branch(self.Z)
        else:
            raise ValueError(f"Unknown opcode {op:02X}")

        return True
