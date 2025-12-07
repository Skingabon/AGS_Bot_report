import 'dotenv/config';
import { google, GoogleApis } from 'googleapis';
import { parseDateTime, startRangeWith } from '../util/helper';
import { GoogleAuth } from 'google-auth-library';

// Базовый класс для работы с Google Sheets
export class GoogleSheetService {
  protected readonly SPREADSHEET_ID: string;
  protected readonly auth: GoogleAuth;
  protected readonly google: GoogleApis;
  protected sheetName: string;

  constructor(sheetName: string) {
    this.SPREADSHEET_ID = process.env.SPREADSHEET_ID!;
    this.sheetName = sheetName;
    this.auth = new google.auth.GoogleAuth({
      keyFile: process.env.PATH_API_GOOGLE,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.google = google;
  }

  // Ищу номер последней строки
  async getLastRowGoogleSheet(): Promise<number> {
    const sheets = this.google.sheets({ version: 'v4', auth: this.auth });

    const columnResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: this.SPREADSHEET_ID,
      range: `${this.sheetName}!A2:A`,
    });

    const values = columnResponse.data.values || [];
    return values.length + 1;
  }

  // Получаю все строки в столбце
  async getGoogleSheetData(field: string = 'A'): Promise<Array<string[]>> {
    const sheets = this.google.sheets({ version: 'v4', auth: this.auth });
    const lastRow = await this.getLastRowGoogleSheet();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: this.SPREADSHEET_ID,
      range: `${this.sheetName}!${field}2:${field}${lastRow}`,
    });

    return response.data.values || [];
  }

  // Получаю все поля из таблицы
  async getRangeValues(range: string): Promise<Array<string[]>> {
    const sheets = this.google.sheets({ version: 'v4', auth: this.auth });

    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.SPREADSHEET_ID,
        range: `${this.sheetName}!${range}`,
        valueRenderOption: 'FORMATTED_VALUE',
      });

      return response.data.values || [];
    } catch (error) {
      console.error(`Ошибка получения диапазона ${range}:`, error);
      return [];
    }
  }

  async updateGoogleField(
    data: string,
    index: number,
    fieldName: string = 'T',
  ) {
    const sheets = this.google.sheets({ version: 'v4', auth: this.auth });
    const res = await sheets.spreadsheets.values.update({
      spreadsheetId: this.SPREADSHEET_ID,
      range: `${this.sheetName}!${fieldName}${index}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[data]] },
    });

    return res;
  }

  async createGoogleFields(data: { values: (string | number)[][] }) {
    const sheets = this.google.sheets({ version: 'v4', auth: this.auth });
    await sheets.spreadsheets.values.append({
      spreadsheetId: this.SPREADSHEET_ID,
      range: `${this.sheetName}!A1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: data.values,
      },
    });
  }

  async updateFieldsGooglePack(
    sheetUpdates: { range: string; values: (string | number)[][] }[],
  ) {
    const sheets = this.google.sheets({ version: 'v4', auth: this.auth });

    const updatesWithSheet = sheetUpdates.map((update) => ({
      ...update,
      range: `${this.sheetName}!${update.range}`,
    }));

    const filteredUpdates = updatesWithSheet.filter((u) => u.values.length > 0);
    if (filteredUpdates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.SPREADSHEET_ID,
        requestBody: {
          data: filteredUpdates,
          valueInputOption: 'RAW',
        },
      });
    }
  }
  async sortSheetByDate(
    isAllField: boolean = false,
    columnIndexForSorting: number = 6,
  ): Promise<void> {
    const sheets = this.google.sheets({ version: 'v4', auth: this.auth });
    const lastRow = 'AL';

    try {
      const rowLength = (await this.getGoogleSheetData('A')).flat().length + 1;
      const startRange = startRangeWith(isAllField, rowLength);

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.SPREADSHEET_ID,
        range: `${this.sheetName}!A${startRange}:${lastRow}`,
      });

      const data: any[][] = response.data.values || [];
      if (data.length === 0) {
        console.log('Нет данных для сортировки');
        return;
      }

      const dataWithDebug = data.map((row, index) => {
        const dateString = row[columnIndexForSorting];
        const parsedDate = parseDateTime(dateString);

        return {
          originalIndex: index,
          row: row,
          dateString: dateString,
          parsedDate: parsedDate,
          timestamp: parsedDate ? parsedDate.getTime() : 0,
        };
      });

      const sortedWithDebug = dataWithDebug.sort((a, b) => {
        if (!a.parsedDate && !b.parsedDate) return 0;
        if (!a.parsedDate) return 1;
        if (!b.parsedDate) return -1;

        return a.timestamp - b.timestamp;
      });

      const sortedData = sortedWithDebug.map((item) => item.row);

      await sheets.spreadsheets.values.update({
        spreadsheetId: this.SPREADSHEET_ID,
        range: `${this.sheetName}!A${startRange}:${lastRow}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: sortedData,
        },
      });
    } catch (error) {
      console.error('Ошибка сортировки:', error);
      throw error;
    }
  }
}

// Специализированный класс для листа Time с дополнительной логикой
export class TimeSheetService extends GoogleSheetService {
  constructor() {
    super('Time'); // Всегда работаем с листом Time
  }
}

// Специализированный класс для листа Control
export class ControlSheetService extends GoogleSheetService {
  constructor() {
    super('Control'); // Всегда работаем с листом Control
  }

  // Здесь можно добавить специфичные методы для Control
  async updateGoogleFieldsBatch(
    values: (string | number)[][],
    rangeStart: number = 2,
  ): Promise<void> {
    const sheets = this.google.sheets({ version: 'v4', auth: this.auth });
    const batchSize = 50;

    for (let i = 0; i < values.length; i += batchSize) {
      const chunk = values.slice(i, i + batchSize);

      const startRow = rangeStart + i;
      const endRow = startRow + chunk.length - 1;

      const range = `${this.sheetName}!A${startRow}:Z${endRow}`; // Z → сколько нужно

      await sheets.spreadsheets.values.update({
        spreadsheetId: this.SPREADSHEET_ID,
        range,
        valueInputOption: 'RAW',
        requestBody: {
          values: chunk,
        },
      });

      // Anti-429 пауза
      await new Promise((res) => setTimeout(res, 150));
    }
  }
}
