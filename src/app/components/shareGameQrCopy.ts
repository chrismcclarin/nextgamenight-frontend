// DECISION Phase 88.6.1-47 (D-30 E6): copy row E6 (D-30, seen and heard) — the in-flight label
// of the Share Game QR button. ONE constant for BOTH Share Game QR buttons (the event page's and
// the calendar day dialog's: CP-4, two sites, one string), in its own leaf module because a Next
// page module cannot carry a named export. REJECTED hosts: (a) EventDayModal.js — the event page
// would import the whole day-dialog component and its colour library just to read one string, a
// new edge in the phone-first event page's bundle; (b) QRCodeModal.js — both host suites stub
// that module with a default export only, so a named import from it is rejected under test.
// The string is byte-equal to the copy table's row E6 (three ASCII dots, no apostrophe).
// Moving this constant into a component module is a decision, not a cleanup.
export const SHARE_GAME_QR_LOADING_LABEL = 'Loading QR code...';
