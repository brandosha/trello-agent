export function randomStr(length: number = 8) {
  let chars = "abcdefghijklmnopqrstuvwxyz";
  chars += chars.toUpperCase() + "0123456789";

  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}