"""Held-out test set (SAMPLE, invented).

Written as a technician would report the fault at the machine, NOT copied from
the maintenance log. `expected` is the fault id from catalog.py, or None when
the right answer is "not enough data" (fault type absent from the knowledge base).
"""

TEST_CASES = [
    # --- faults present in the knowledge base ---
    dict(id="T01", machine="C-02", text="Temperature alarm, it stops after about half an hour", error_code="E101", expected="F01"),
    dict(id="T02", machine="C-01", text="الكمبروسر بيطفي لحاله بعد نص ساعة وبيطلع انذار حرارة", error_code=None, expected="F01"),
    dict(id="T03", machine="C-03", text="High temp alarm and the oil sight glass is almost empty", error_code="E101", expected="F02"),
    dict(id="T04", machine="C-04", text="Overheating within 10 minutes of start, the cooler is cold when I touch it", error_code=None, expected="F03"),
    dict(id="T05", machine="C-01", text="Cooling fan is not spinning", error_code="E305", expected="F04"),
    dict(id="T06", machine="C-02", text="Air delivery is low and pressure takes long to build up", error_code="E210", expected="F05"),
    dict(id="T07", machine="C-04", text="انذار فرق ضغط السبريتر والامبير عالي", error_code="E220", expected="F06"),
    dict(id="T08", machine="C-03", text="Production says there is oil coming out of the air tools, we are adding oil every week", error_code=None, expected="F07"),
    dict(id="T09", machine="C-01", text="Compressor is running, motor on, but the pressure never goes up. No alarm.", error_code=None, expected="F09"),
    dict(id="T10", machine="C-02", text="It stays in unload mode", error_code="E410", expected="F10"),
    dict(id="T11", machine="C-04", text="Machine running loaded non stop and still the plant pressure is low, you can hear air hissing near line 2", error_code=None, expected="F11"),
    dict(id="T12", machine="C-03", text="Display shows pressure 25 bar then 0 then 14, jumping around", error_code="E501", expected="F12"),
    dict(id="T13", machine="C-01", text="won't start, temperature shows -99", error_code="E502", expected="F13"),
    dict(id="T14", machine="C-02", text="Main motor tripped on overload, it's a very hot day", error_code="E301", expected="F14"),
    dict(id="T15", machine="C-04", text="After the electricity maintenance yesterday the compressor won't start, phase alarm", error_code="E310", expected="F15"),
    dict(id="T16", machine="C-03", text="Alarm E001 and I cannot reset it", error_code="E001", expected="F16"),
    dict(id="T17", machine="C-01", text="صوت صفير قوي وقت التشغيل والهوا قليل", error_code=None, expected="F17"),
    dict(id="T18", machine="C-02", text="Rumbling noise from the electric motor and a lot of vibration", error_code=None, expected="F18"),
    dict(id="T19", machine="C-03", text="Water in the air lines at the packing machines, the auto drain never opens", error_code=None, expected="F19"),
    dict(id="T20", machine="C-04", text="When I restart it right after stopping, it fails to start", error_code="E302", expected="F21"),
    dict(id="T21", machine="C-01", text="Contactors clicking and chattering during start, motor stalls", error_code="E303", expected="F22"),
    dict(id="T22", machine="C-02", text="There is oil on the floor under the compressor", error_code=None, expected="F23"),
    dict(id="T23", machine="C-03", text="Service due message, oil looks very dark", error_code="E601", expected="F24"),
    dict(id="T24", machine="C-04", text="Dew point alarm and water in the lines", error_code="E701", expected="F27"),
    dict(id="T25", machine="C-01", text="Compressor loads and unloads every few seconds", error_code=None, expected="F28"),
    # --- faults NOT in the knowledge base: correct answer is "not enough data" ---
    dict(id="T26", machine="C-02", text="Inverter shows DC bus overvoltage and the drive trips", error_code="E801", expected=None),
    dict(id="T27", machine="C-04", text="Airend is seized, the motor hums but the screw won't turn even by hand", error_code=None, expected=None),
    dict(id="T28", machine="C-03", text="Coupling rubber pieces found inside the canopy, knocking noise", error_code=None, expected=None),
    dict(id="T29", machine="C-01", text="Touchscreen works but the remote start from the SCADA system does nothing", error_code=None, expected=None),
    dict(id="T30", machine="C-02", text="Receiver tank has visible corrosion and a small weep at a weld", error_code=None, expected=None),
]
