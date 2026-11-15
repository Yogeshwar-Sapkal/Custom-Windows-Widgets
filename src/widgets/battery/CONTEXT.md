# Battery

A widget that shows how much battery is left on this PC and on paired Bluetooth devices.

## Language

**This PC**:
The computer the widget runs on. It has a battery row only if it is a laptop or has a battery; a desktop shows no PC row.
_Avoid_: Laptop, host, system

**Device**:
A Bluetooth device paired with this PC (headphones, mouse, keyboard, phone), identified by its Bluetooth address. One physical device is one Device even if Windows lists it several times.
_Avoid_: Peripheral, accessory, gadget

**Battery level**:
A whole-number percentage Windows reports for a Device or This PC. Not every Device reports one.
_Avoid_: Charge, power, juice

**Not reported**:
A Device that Windows lists but gives no Battery level for. It is shown with a dash, never with a guessed value.
_Avoid_: Unknown, N/A, 0%

**Connected**:
Whether a paired Device is currently linked to this PC. Devices that are not connected are hidden unless the user asks to see them.
_Avoid_: Online, active, present

**Phone**:
A phone appears only as a Device paired over Bluetooth. Phone Link exposes no battery information to other programs, so a Phone has a Battery level only if Windows reports one for the Bluetooth pairing.
_Avoid_: Mobile, handset
