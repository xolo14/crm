/** Download one worksheet as an .xlsx file. */
export async function downloadExcelSheet(
  fileName: string,
  sheetName: string,
  rows: Record<string, string | number>[],
): Promise<void> {
  const XLSX = await import("@stackline/xlsx");
  const safeName = sheetName.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Sheet1";
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, safeName);
  const name = fileName.toLowerCase().endsWith(".xlsx") ? fileName : `${fileName}.xlsx`;
  XLSX.writeFile(workbook, name);
}

export function excelFileStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
