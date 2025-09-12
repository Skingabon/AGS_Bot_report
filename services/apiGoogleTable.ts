//TODO: заменить на нужное ID таблицы
import 'dotenv/config';
import { google } from 'googleapis';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'Time';
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.PATH_API_GOOGLE,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// export async function getGoogleSheetData(
//   field: string = 'B',
// ): Promise<Array<string[]>> {
//   const sheets = google.sheets({ version: 'v4', auth });
//   const response = await sheets.spreadsheets.values.get({
//     spreadsheetId: SPREADSHEET_ID,
//     //TODO найти номер последней строки с данными
//     range: `${SHEET_NAME}!${field}2:${field}1000`,
//   });
//   return response.data.values || [];
// }

//Ищу последнюю строку с данными и формирую диапазон для заполнения
export async function getGoogleSheetData(
  field: string = 'A',
): Promise<Array<string[]>> {
  const sheets = google.sheets({ version: 'v4', auth });

  // Сначала получаем все строки в выбранном столбце, начиная со второй
  const columnResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!${field}2:${field}`,
  });

  const values = columnResponse.data.values || [];

  // Вычисляем последнюю строку с данными
  const lastRow = values.length + 1; // +1, так как данные начинаются со 2-й строки
  // Теперь запрашиваем только нужный диапазон
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!${field}2:${field}${lastRow}`,
  });

  return response.data.values || [];
}

export async function getRangeValues(range: string): Promise<Array<string[]>> {
  const sheets = google.sheets({ version: 'v4', auth });

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!${range}`,
      valueRenderOption: 'FORMATTED_VALUE',
    });

    return response.data.values || [];
  } catch (error) {
    console.error(`Ошибка получения диапазона ${range}:`, error);
    return [];
  }
}

export async function updateGoogleField(
  data: string,
  index: number,
  fieldName: string = 'T',
) {
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!${fieldName}${index}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[data]] },
  });

  return res;
}

type LeadRow = {
  values: (string | number)[][];
};

export async function createGoogleFields(data: LeadRow) {
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1`, // Диапазон, начиная с первой строки
    valueInputOption: 'RAW',
    requestBody: {
      values: data.values,
    },
  });
}

export async function updateGoogleFields(
  data: LeadRow,
  startField: string,
  endField: string,
) {
  const sheets = google.sheets({ version: 'v4', auth });

  // Сначала получаем все строки в выбранном столбце, начиная со второй
  const columnResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!${startField}2:${startField}`,
  });

  const values = columnResponse.data.values || [];
  // Вычисляем последнюю строку с данными
  const lastRow = values.length + 1;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${startField}2:${endField}${lastRow}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: data.values,
    },
  });
}

type sheetUpdates = { range: string; values: (string | number)[][] };

export const updateFieldsGooglePack = async (sheetUpdates: sheetUpdates[]) => {
  const sheets = google.sheets({ version: 'v4', auth });

  // Добавляем название листа к каждому range
  const updatesWithSheet = sheetUpdates.map((update) => ({
    ...update,
    range: `${SHEET_NAME}!${update.range}`,
  }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      data: updatesWithSheet,
      valueInputOption: 'RAW',
    },
  });
};
