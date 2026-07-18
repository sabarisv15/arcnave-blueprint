// Every base64-upload endpoint in this backend (documents.js,
// timetablePeriods.js's CSV import, examination.js) expects the raw
// base64 payload only — no data: URI prefix — so this strips it.
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const commaIndex = result.indexOf(',');
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
