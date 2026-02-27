class CPU6502:
    CARRY = 0x01
    ZERO = 0x02
    IRQ = 0x04
    DECIMAL = 0x08
    BRK = 0x10
    OVERFLOW = 0x40
    NEGATIVE = 0x80

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
        print(f"Output to console: {value:04X}| {int(value)}")

    @property
    def C(self):
        return (self._P & self.CARRY) != 0

    @C.setter
    def C(self, v):
        self._P = (self._P | self.CARRY) if v else (self._P & ~self.CARRY)

    @property
    def Z(self):
        return (self._P & self.ZERO) != 0

    @Z.setter
    def Z(self, v):
        self._P = (self._P | self.ZERO) if v else (self._P & ~self.ZERO)

    @property
    def I(self):
        return (self._P & self.IRQ) != 0

    @I.setter
    def I(self, v):
        self._P = (self._P | self.IRQ) if v else (self._P & ~self.IRQ)

    @property
    def D(self):
        return (self._P & self.DECIMAL) != 0

    @D.setter
    def D(self, v):
        self._P = (self._P | self.DECIMAL) if v else (self._P & ~self.DECIMAL)

    @property
    def B(self):
        return (self._P & self.BRK) != 0

    @B.setter
    def B(self, v):
        self._P = (self._P | self.BRK) if v else (self._P & ~self.BRK)

    @property
    def V(self):
        return (self._P & self.OVERFLOW) != 0

    @V.setter
    def V(self, v):
        self._P = (self._P | self.OVERFLOW) if v else (self._P & ~self.OVERFLOW)

    @property
    def N(self):
        return (self._P & self.NEGATIVE) != 0

    @N.setter
    def N(self, v):
        self._P = (self._P | self.NEGATIVE) if v else (self._P & ~self.NEGATIVE)

    def update_zn_flags(self, val):
        self.Z = (val & 0xFFFF) == 0
        self.N = (val & 0x8000) != 0

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
            f"PC:${self._PC:04X}  A:${self._A:04X}  X:${self._X:04X}  Y:${self._Y:04X}  "
            f"SP:${self._SP:02X}  P:${self._P:02X}  {flags}  cycles:{self.cycles}"
        )

    def snapshot(self):
        return {
            "PC": self._PC & 0xFFFF,
            "A": self._A & 0xFFFF,
            "X": self._X & 0xFFFF,
            "Y": self._Y & 0xFFFF,
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

    def LDA(self, v):
        self._A = v & 0xFFFF
        self.update_zn_flags(self._A)
        self.cycles += 2

    def LDX(self, v):
        self._X = v & 0xFFFF
        self.update_zn_flags(self._X)
        self.cycles += 2

    def LDY(self, v):
        self._Y = v & 0xFFFF
        self.update_zn_flags(self._Y)
        self.cycles += 2

    def ADC(self, v):
        t = self._A + v + (1 if self.C else 0)
        r = t & 0xFFFF
        self.V = ((self._A ^ r) & (v ^ r) & 0x8000) != 0
        self.C = t > 0xFFFF
        self._A = r
        self.update_zn_flags(self._A)
        self.cycles += 2

    def SBC(self, v):
        t = self._A - v - (0 if self.C else 1)
        r = t & 0xFFFF
        self.V = ((self._A ^ r) & ((~v) ^ r) & 0x8000) != 0
        self.C = t >= 0
        self._A = r
        self.update_zn_flags(self._A)
        self.cycles += 2

    def CMP(self, v):
        d = self._A - v
        self.update_zn_flags(d & 0xFFFF)
        self.C = self._A >= v
        self.cycles += 2

    def CMPC(self, addr):
        v = self.memory[addr] | (self.memory[addr + 1] << 8)
        d = self._A - v
        self.update_zn_flags(d & 0xFFFF)
        self.C = self._A >= v
        self.cycles += 4

    def CPX(self, v):
        d = self._X - v
        self.update_zn_flags(d & 0xFFFF)
        self.C = self._X >= v
        self.cycles += 2

    def AND(self, v):
        self._A &= v
        self.update_zn_flags(self._A)
        self.cycles += 2

    def ORA(self, v):
        self._A |= v
        self.update_zn_flags(self._A)
        self.cycles += 2

    def EOR(self, v):
        self._A ^= v
        self.update_zn_flags(self._A)
        self.cycles += 2

    def TAX(self):
        self._X = self._A
        self.update_zn_flags(self._X)
        self.cycles += 2

    def XTA(self):
        self._A = self._X
        self.update_zn_flags(self._A)
        self.cycles += 2

    def CLC(self):
        self.C = False
        self.cycles += 1

    def NOP(self):
        self.cycles += 2

    def A_to_store(self, addr):
        self.memory[addr] = self._A & 0xFF
        self.memory[addr + 1] = (self._A >> 8) & 0xFF
        self.cycles += 4

    def from_store_to_A(self, addr):
        low = self.memory[addr]
        high = self.memory[addr + 1]
        self._A = (high << 8) | low
        self.update_zn_flags(self._A)
        self.cycles += 4

    def X_to_store(self, addr):
        self.memory[addr] = self._X & 0xFF
        self.memory[addr + 1] = (self._X >> 8) & 0xFF
        self.cycles += 4

    def from_store_to_X(self, addr):
        low = self.memory[addr]
        high = self.memory[addr + 1]
        self._X = (high << 8) | low
        self.update_zn_flags(self._X)
        self.cycles += 4

    def Output_to_console(self, addr):
        low = self.memory[addr]
        high = self.memory[addr + 1]
        value = (high << 8) | low
        self._output_handler(value, addr)
        self.cycles += 4

    def from_console_to_A(self):
        self._A = int(self._input_provider()) & 0xFFFF
        self.update_zn_flags(self._A)
        self.cycles += 2

    def MUL(self, addr):
        val = self.memory[addr] | (self.memory[addr + 1] << 8)
        self._A = (self._A * val) & 0xFFFF
        self.update_zn_flags(self._A)
        self.cycles += 4

    def MULM(self, addr):
        val = self.memory[addr] | (self.memory[addr + 1] << 8)
        result = (self._A * val) & 0xFFFF
        self.memory[addr] = result & 0xFF
        self.memory[addr + 1] = (result >> 8) & 0xFF
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
            val = self.memory[self._PC] | (self.memory[self._PC + 1] << 8)
            self._PC += 2
            self.ORA(val)

        elif op == 0x10:
            self.branch(not self.N)

        elif op == 0x14:
            addr = self.memory[self._PC]
            self._PC += 1
            self.MULM(addr)

        elif op == 0x18:
            self.CLC()

        elif op == 0x29:
            val = self.memory[self._PC] | (self.memory[self._PC + 1] << 8)
            self._PC += 2
            self.AND(val)

        elif op == 0x30:
            self.branch(self.N)

        elif op == 0x49:
            val = self.memory[self._PC] | (self.memory[self._PC + 1] << 8)
            self._PC += 2
            self.EOR(val)

        elif op == 0x4C:
            low = self.memory[self._PC]
            high = self.memory[self._PC + 1]
            self._PC = (high << 8) | low
            self.cycles += 3

        elif op == 0x50:
            self.branch(not self.V)

        elif op == 0x69:
            val = self.memory[self._PC] | (self.memory[self._PC + 1] << 8)
            self._PC += 2
            self.ADC(val)

        elif op == 0x70:
            self.branch(self.V)

        elif op == 0x90:
            self.branch(not self.C)

        elif op == 0xA0:
            val = self.memory[self._PC] | (self.memory[self._PC + 1] << 8)
            self._PC += 2
            self.LDY(val)

        elif op == 0xA2:
            val = self.memory[self._PC] | (self.memory[self._PC + 1] << 8)
            self._PC += 2
            self.LDX(val)

        elif op == 0xA9:
            val = self.memory[self._PC] | (self.memory[self._PC + 1] << 8)
            self._PC += 2
            self.LDA(val)

        elif op == 0xAA:
            self.TAX()

        elif op == 0xB0:
            self.branch(self.C)

        elif op == 0xC9:
            val = self.memory[self._PC] | (self.memory[self._PC + 1] << 8)
            self._PC += 2
            self.CMP(val)

        elif op == 0xCD:
            addr = self.memory[self._PC]
            self._PC += 1
            self.CMPC(addr)

        elif op == 0xD0:
            self.branch(not self.Z)

        elif op == 0xE0:
            val = self.memory[self._PC] | (self.memory[self._PC + 1] << 8)
            self._PC += 2
            self.CPX(val)

        elif op == 0xE9:
            val = self.memory[self._PC] | (self.memory[self._PC + 1] << 8)
            self._PC += 2
            self.SBC(val)

        elif op == 0xEA:
            self.NOP()

        elif op == 0xF0:
            self.branch(self.Z)

        else:
            raise ValueError(f"Unknown opcode {op:02X}")

        return True
