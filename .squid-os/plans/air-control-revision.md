# Air Control Revision

## Rules

### Running → Jump
Preserve full horizontal velocity.

### Air Direction Reversal
Reverse direction immediately while preserving the current speed magnitude. Do not decelerate to zero before reversing.

### Stationary / Near-Zero → Jump
Apply gradual horizontal air acceleration (ramp-up) from the current low velocity toward full air speed. This enables precise jumps onto nearby obstacles/platforms.

### Direction Change During Ramp-Up
Immediately flip the current velocity direction while preserving its magnitude, then continue ramping toward full speed in the new direction.

## Core Rule

Ramp-up applies only when entering the air at low/near-zero horizontal velocity. It must not make normal running jumps or mid-air direction changes feel sluggish.
