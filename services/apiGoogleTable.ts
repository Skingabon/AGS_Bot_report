//TODO: заменить на нужное ID таблицы
import 'dotenv/config';
import { google } from 'googleapis';

const SPREADSHEET_ID = '1uQBd97IuX5BL6uY6MWkrpECr7YXu9H5uRDjhjwkom-8';
const SHEET_NAME = 'Time';
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.PATH_API_GOOGLE,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

export async function getGoogleSheetData(
  field: string = 'B',
): Promise<Array<string[]>> {
  const sheets = google.sheets({ version: 'v4', auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    //TODO найти номер последней строки с данными
    range: `${SHEET_NAME}!${field}2:${field}1000`,
  });
  return response.data.values || [];
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
    range: 'A1', // Диапазон, начиная с первой строки
    valueInputOption: 'RAW',
    requestBody: {
      values: data.values,
    },
  });
}
