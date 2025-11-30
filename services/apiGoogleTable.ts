//TODO: заменить на нужное ID таблицы
import 'dotenv/config';
import { google } from 'googleapis';
import { parseDateTime, startRangeWith } from '../util/helper';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'Time';
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.PATH_API_GOOGLE,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// Ищу номер последней строки
export async function getLastRowGoogleSheet() {
  const sheets = google.sheets({ version: 'v4', auth });

  // Сначала получаем все строки в выбранном столбце, начиная со второй
  const columnResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2:A`,
  });

  const values = columnResponse.data.values || [];

  // Вычисляем последнюю строку с данными
  const lastRow = values.length + 1; // +1, так как данные начинаются со 2-й строки

  return lastRow;
}

// Получаю все строки в столбце
export async function getGoogleSheetData(
  field: string = 'A',
): Promise<Array<string[]>> {
  const sheets = google.sheets({ version: 'v4', auth });

  const lastRow = getLastRowGoogleSheet();
  // Теперь запрашиваем только нужный диапазон
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!${field}2:${field}${lastRow}`,
  });

  return response.data.values || [];
}

// Получаю все поля из таблицы
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

// utils/sheetSorter.ts
export const sortSheetByDate = async (isAllField = false): Promise<void> => {
  const sheets = google.sheets({ version: 'v4', auth });
  const lastRow = 'AL';

  try {
    const rowLength = (await getGoogleSheetData('A')).flat().length + 1;
    const startRange = startRangeWith(isAllField, rowLength);
    // Получаем данные
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A${startRange}:${lastRow}`,
    });

    const data = response.data.values || [];
    if (data.length === 0) {
      console.log('Нет данных для сортировки');
      return;
    }

    // Добавляем отладочную информацию
    const dataWithDebug = data.map((row, index) => {
      const dateString = row[6]; // столбец G
      const parsedDate = parseDateTime(dateString);

      return {
        originalIndex: index,
        row: row,
        dateString: dateString,
        parsedDate: parsedDate,
        timestamp: parsedDate ? parsedDate.getTime() : 0,
      };
    });

    // Сортируем по timestamp
    const sortedWithDebug = dataWithDebug.sort((a, b) => {
      // Сначала валидные даты, потом невалидные
      if (!a.parsedDate && !b.parsedDate) return 0;
      if (!a.parsedDate) return 1;
      if (!b.parsedDate) return -1;

      return a.timestamp - b.timestamp; // по возрастанию
    });

    // Извлекаем только строки
    const sortedData = sortedWithDebug.map((item) => item.row);

    // Записываем обратно
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A${startRange}:${lastRow}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: sortedData,
      },
    });
  } catch (error) {
    console.error('Ошибка сортировки:', error);
    throw error;
  }
};
