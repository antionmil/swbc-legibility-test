const { isPublicAddress } = await import("../src/lib/address.ts");
const cases = {
  "::ffff:7f00:1": false, "::ffff:127.0.0.1": false, "::ffff:a9fe:a9fe": false, "::ffff:c0a8:101": false,
  "::1": false, "::": false, "64:ff9b::7f00:1": false, "64:ff9b::a9fe:a9fe": false, "2002:7f00:1::": false,
  "fd12:3456::1": false, "fe80::1": false, "::127.0.0.1": false,
  "2606:4700:4700::1111": true, "::ffff:8.8.8.8": true, "8.8.8.8": true, "93.184.216.34": true,
};
let bad = 0;
for (const [ip, expected] of Object.entries(cases)) {
  const got = isPublicAddress(ip);
  if (got !== expected) bad++;
  console.log(`${got === expected ? "ok  " : "FAIL"} ${ip.padEnd(24)} public=${got}`);
}
console.log(bad ? `${bad} FAILURES` : "all address cases pass");
if (bad) process.exit(1);
