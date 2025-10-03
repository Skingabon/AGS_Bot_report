import { Context } from 'grammy';
import { domain, getAllPipelines, getLeadToday } from '../services/apiAmo';
import {
  createGoogleFields,
  getGoogleSheetData,
  getRangeValues,
} from '../services/apiGoogleTable';
import {
  convertDateFormat,
  formatDateByPeriod,
  getPeriodTimestamps,
} from '../helper';
import { getParamsLead } from './updateFields';

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

    const response = await getLeadToday(startTimestamp, endTimestamp);
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
    const rowLength = (await getGoogleSheetData('A')).flat().length;
    const allData = await getRangeValues(`A2:AK${rowLength + 1}`);

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
      // Column AC (индекс 28) - статус
      const status = row[28] || '';

      // Пропускаем пустые даты
      if (!dateString.trim()) continue;

      try {
        const dateClean = convertDateFormat(dateString.split(' ')[0]);
        if (!dateClean) continue;

        const [dateTimestamp] = getPeriodTimestamps(dateClean);

        if (dateTimestamp >= startInputDate && dateTimestamp <= endInputDate) {
          result.totalLeads++;

          // Считаем статусы
          if (status === 'Кв. Лид') {
            result.countActiveLead++;

            if (stage === 'Закрыто и не реализовано') {
              result.countClosed++;
            } else {
              result.inProgress++;
            }
            if (
              pipeline === 'Отдел инжиниринга' ||
              pipeline === 'Отдел серийного оборудования'
            ) {
              result.pipelinesSeriesIng++;
            }
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
  ctx: Context | null,
  startDate?: string,
  endDate?: string,
) => {
  if (!ctx) return;
  await ctx.reply('Начинаю создавать таблицу');
  try {
    const pipelinesResponse = await getAllPipelines();
    await ctx.reply('Нашел данные о воронке');
    const pipelines = pipelinesResponse;
    const pipelinesMap = pipelines.reduce(
      (
        acc: { [key: number]: string },
        pipeline: { id: number; name: string },
      ) => {
        acc[pipeline.id] = pipeline.name;
        return acc;
      },
      {},
    );
    let startTimestamp;
    let endTimestamp;
    // Пример временных меток (начало и конец дня)
    if (!startDate || !endDate) {
      const today = new Date();

      const startOfDay = new Date(today);
      const endOfDay = new Date(today);

      startOfDay.setHours(0, 0, 0, 0);
      endOfDay.setHours(23, 59, 59, 999);

      // Конвертируем в Unix timestamp (секунды)
      startTimestamp = Math.floor(startOfDay.getTime() / 1000); //TODO Для прода
      endTimestamp = Math.floor(endOfDay.getTime() / 1000);
    } else {
      const startDateFormated = new Date(formatDateByPeriod(startDate));
      const endDateFormated = new Date(formatDateByPeriod(endDate));
      endDateFormated.setHours(23, 59, 59, 999);

      startTimestamp = Math.floor(startDateFormated.getTime() / 1000);
      endTimestamp = Math.floor(endDateFormated.getTime() / 1000);
    }

    const response = await getLeadToday(startTimestamp, endTimestamp);

    await ctx.reply('Собрал все сделки за выбранный преиод');

    let leads = response;
    if (!leads || leads.length === 0) {
      throw new Error('No leads found for the given filter.');
    }
    leads = leads.sort((a, b) => a.created_at - b.created_at);

    // Преобразование данных для загрузки в Google Sheets
    const googleSheetsData = leads.map((lead) => {
      const {
        newLeadSourse,
        statusName,
        pipelineName,
        createdAtFormatted,
        omTakenAt,
        diffCreatedToTaken,
        omTakenBy,
        omAssignedAt,
        diffAssignedToTaken,
        omAssignedBy,
        omTakeIng,
        diffTakenToTakeIng,
        omTakenByIng,
        omRaspredByIngTime,
        diffIngRukManeger,
        omRaspredByIng,
        formattedUpdatedAt,
        reasonForRefusal,
      } = getParamsLead({ lead, pipelinesMap });

      // leads.sort((a, b) => a.created_at - b.created_at);

      return [
        lead.id, // 1 A ID
        lead.name, // 2 B
        `https://${domain}.amocrm.ru/leads/detail/${lead.id}`, // 3 C Ссылка на лид
        newLeadSourse, // 4 D Источник сделки
        statusName, // 5 E Название статуса
        pipelineName, // 6 F Название воронки
        createdAtFormatted, // 7 G Создан
        omTakenAt, // 8 H ДатаВремя "ОМ Взято в работу"
        diffCreatedToTaken, // 9 I Дельта Взято в работу - Создание ВРЕМЯ
        omTakenBy, // 10 J Рук отдела Менеджер "ОМ Взято в работу"
        omAssignedAt, //11 K На серию. ДатаВремя "Время ОМ квал серия"
        diffAssignedToTaken, // 12 L Дельта На серию - Взято в работу  ВРЕМЯ
        omAssignedBy, // 13 M Менеджер Серии "ОМ Квал серия"
        omTakeIng, // 14 N Распределен на инжиниринг
        diffTakenToTakeIng, //15 O На инж - Взято в работу
        omTakenByIng, // 16 Р Кто распределил наинжиниринг "ОМ Квал ИНЖ"
        omRaspredByIngTime, // 17 Q Время распределения на менеджера инжиниринга "Время Распр ОМ квал ИНЖ"
        diffIngRukManeger, // 18 R  Дельта распредления Кто распределил на менеджера
        omRaspredByIng, // 14 S Менеджер отдела инжиниринга. Распределен на менеджера "Распр ОМ квал ИНЖ"
        '-', // Первое касание
        // dateIncomingCallArr[index], // 16 T Первое касание. Реакция менеджера на лид Первое касание
        '-', //deltaTimeFirstResponse
        // deltaTimeFirstResponse, // 17 U Дельта от распределения на серию или инжтиниринг до первого касания менеджера - звонок или письмо или отввет в мессенджере.
        '-', // timeAllWork
        // timeAllWork, // 18 V  Общее время сделки в работе от даты/время создания до даты последнего действия W
        formattedUpdatedAt, // 19 W Дата/время последнего обновления в сделке
        // lead.price,
        // lead.status_id, // ID статуса
        // statusName, // Название статуса
        // pipelineName, // Название воронки
        // lead.id, // ID
        // newLeadAdmin, // ответственный в сделке
        // newLeadTime, // Время сделка Создана на этапе Новая заявка
        // new Date(lead.updated_at * 1000).toLocaleString(),
        reasonForRefusal, // причина отказа
        lead.price, // бюджет
      ];
    });

    const resource = {
      values: googleSheetsData,
    };
    await ctx.reply('Добавляю в таблицу');
    await createGoogleFields(resource);
    await ctx.reply('Все готово!');
  } catch (error) {
    if (error instanceof Error) {
      await ctx.reply('Бот остановлен. Скорее всего сделок нет');

      console.log('error' + error.message);
    }
  }
};
