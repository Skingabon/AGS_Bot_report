import { Context } from 'grammy';
import {
  convertDateFormat,
  getFieldValue,
  getPeriodTimestamps,
} from '../util/helper';
import { TimeSheetService } from '../services/apiGoogleTable';
import { AmoAPI } from '../services/apiAmo';
import { DOMAIN } from './contants';
import { getLeadsTodayOrByPeriod } from './utils';

export const showReportLeadByPeriod = async (
  ctx: Context,
  startDate: string,
  endDate?: string,
) => {
  try {
    let timeDate: number[];

    if (endDate) {
      timeDate = getPeriodTimestamps(startDate, endDate);
    } else {
      timeDate = getPeriodTimestamps(startDate);
    }
    const [startTimestamp, endTimestamp] = timeDate;

    const response = await new AmoAPI().getLeadsToday(
      startTimestamp,
      endTimestamp,
    );
    const totalLeads: number = response.length;
    let countSeries = 0;
    let countIng = 0;
    let countClosed = 0;
    let notDistributed = 0;
    let service = 0;
    let seller = 0;
    response.map((lead) => {
      if (lead.pipeline_id === 6720186) {
        seller++;
      }
      if (lead.pipeline_id === 9772278) {
        service++;
      }
      if (lead.status_id === 143) {
        countClosed++;
        return;
      }
      if (lead.status_id === 50238949 || lead.status_id === 50238952) {
        // Новая заявка или взято в работу
        notDistributed++;
      }
      if (!lead.custom_fields_values) return;
      lead.custom_fields_values.map((el) => {
        if (el.field_id === 606679) {
          // Если поле серии заполнено
          countSeries++;
        }
        if (el.field_id === 606681) {
          countIng++;
        }
      });
    });

    const period = !endDate ? 'сегодня' : `период: ${startDate}-${endDate}`;

    const periodOutput = `Отчет за ${period}`;
    await ctx.reply(
      `${periodOutput}
Всего сделок: <b>${totalLeads}</b>
Не распределено: <b>${notDistributed}</b>
Серия: <b>${countSeries}</b>
Инжиниринг: <b>${countIng}</b>
Сервис: <b>${service}</b>  
Поставщики: <b>${seller}</b>
Закрыто и нереализовано: <b>${countClosed}</b>`,
      {
        parse_mode: 'HTML',
      },
    );
  } catch (error) {
    if (error instanceof Error) {
      await ctx.reply('Бот остановлен. Скорее всего сделок нет');

      console.log('error' + error.message);
    }
  }
};

interface IResultLeadMarketing {
  totalLeads: number;
  countActiveLead: number;
  countClosed: number;
  inProgress: number;
  pipelinesSeriesIng: number;
}

export const getReportMarketing = async (
  ctx: Context,
  startDate: string,
  endDate?: string,
): Promise<IResultLeadMarketing | undefined> => {
  try {
    const timeDate = endDate
      ? getPeriodTimestamps(startDate, endDate)
      : getPeriodTimestamps(startDate);

    const [startInputDate, endInputDate] = timeDate;

    // Получаем ВСЕ данные одним запросом - это ключевое!
    const allData = await new TimeSheetService().getRangeValues();

    const result: IResultLeadMarketing = {
      totalLeads: 0,
      countActiveLead: 0,
      inProgress: 0,
      pipelinesSeriesIng: 0,
      countClosed: 0,
    };

    // Теперь все данные синхронизированы по строкам!
    for (let i = 0; i < allData.length; i++) {
      const row = allData[i];
      // E
      const stage = row[4] || '';
      // F
      const pipeline = row[5] || '';
      // Column G (индекс 6) - дата создания
      const dateString = row[6] || '';
      // Column H (индекс 7) - Взято в работу
      const inWork = row[7] || '';
      // Column X (индекс 23) - Причина отказа
      const rejectColumn = row[23] || '';

      // Пропускаем пустые даты
      if (!dateString.trim()) continue;

      try {
        const dateClean = convertDateFormat(dateString.split(' ')[0]);
        if (!dateClean) continue;

        const [dateTimestamp] = getPeriodTimestamps(dateClean);
        if (!dateTimestamp) continue;

        if (dateTimestamp >= startInputDate && dateTimestamp <= endInputDate) {
          result.totalLeads++;
          //  Считаем статусы
          if (inWork) {
            result.countActiveLead++;
          }
          if (
            stage !== 'Закрыто и не реализовано' &&
            (pipeline === 'Отдел инжиниринга' ||
              pipeline === 'Отдел серийного оборудования')
          ) {
            result.countActiveLead++;
          }
          if (rejectColumn) {
            result.countClosed++;
          }
        }
      } catch (error) {
        console.error(`Ошибка обработки строки ${i + 2}:`, error);
      }
    }

    return result;
  } catch (error) {
    if (error instanceof Error) {
      await ctx.reply('Ошибка при формировании отчета');
      console.error('Ошибка в getReportMarketing:', error.message);
    }
    return undefined;
  }
};

export const createReportTimeByPeriod = async (
  startDate?: string,
  endDate?: string,
) => {
  console.log('Создаем тиаблицу');
  try {
    const { leads } = await getLeadsTodayOrByPeriod(startDate, endDate);

    // Преобразование данных для загрузки в Google Sheets
    const googleSheetsData: (string | number)[][] = [];
    for (let i = 0; i <= leads.length; i++) {
      const lead = leads[i];
      try {
        const fields = lead.custom_fields_values || [];
        const newLeadSource = getFieldValue(fields, 'Источник лида') || '';

        googleSheetsData.push([
          lead.id, // 1 A ID
          lead.name, // 2 B
          `https://${DOMAIN}.amocrm.ru/leads/detail/${lead.id}`, // 3 C Ссылка на лид
          newLeadSource, // 4 D Источник сделки
          '', // 5 E Название статуса
          '', // 6 F Название воронки
          ``, // 7 G Создан
          '', // 8 H ДатаВремя "ОМ Взято в работу"
          '', // 9 I Дельта Взято в работу - Создание ВРЕМЯ
          '', // 10 J Рук отдела Менеджер "ОМ Взято в работу"
          '', //11 K На серию. ДатаВремя "Время ОМ квал серия"
          '', // 12 L Дельта На серию - Взято в работу  ВРЕМЯ
          '', // 13 M Менеджер Серии "ОМ Квал серия"
          '', // 14 N Распределен на инжиниринг
          '', //15 O На инж - Взято в работу
          '', // 16 Р Кто распределил наинжиниринг "ОМ Квал ИНЖ"
          '', // 17 Q Время распределения на менеджера инжиниринга "Время Распр ОМ квал ИНЖ"
          '', // 18 R  Дельта распредления Кто распределил на менеджера
          '', // 14 S Менеджер отдела инжиниринга. Распределен на менеджера "Распр ОМ квал ИНЖ"
          '', // Первое касание
          // dateIncomingCallArr[index], // 16 T Первое касание. Реакция менеджера на лид Первое касание
          '', //deltaTimeFirstResponse
          // deltaTimeFirstResponse, // 17 U Дельта от распределения на серию или инжтиниринг до первого касания менеджера - звонок или письмо или отввет в мессенджере.
          '', // timeAllWork
          // timeAllWork, // 18 V  Общее время сделки в работе от даты/время создания до даты последнего действия W
          '', // 19 W Дата/время последнего обновления в сделке
          '', // причина отказа
          '', // бюджет
          '', // Z
          '', //AA
          '', //AB
          '', //AC
          '', //AD
          '', //AE
          '', //AF
          '', //AG
          '', //AH
          '', //AI
          '', //AJ
          '', //AK
          '', //AL
          '', //AM
          '', //AN
          '', //AO
          '', //AP
          '', //AQ
          '', //AR
          '', //AS
          lead.created_at, //AT
        ]);
      } catch (e) {
        if (e instanceof Error) {
          console.log(e);
        }
      }
    }

    const resource = {
      values: googleSheetsData,
    };
    const sheetService = new TimeSheetService();
    await sheetService.createGoogleFieldsBatch(resource);
  } catch (error) {
    if (error instanceof Error) {
      console.log('error ' + error.message);
    }
  }
};
