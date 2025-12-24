import {
  formatDate,
  formatTimeHHMMSS,
  getDate,
  getFieldValue,
} from '../util/helper';
import { ControlSheetService } from '../services/apiGoogleTable';
import { getLeadsTodayOrByPeriod } from './utils';
import { DOMAIN } from './contants';
import {
  incomingActionDateFromContact,
  incomingCallDate,
} from './updateFields';
import { AmoAPI } from '../services/apiAmo';
import {
  LeadResponsibleChangedEvent,
  LeadStatusChangedEvent,
  Task,
} from '../interfaces';
import { getStatusLead } from './statusList';

const maxColumnName = 'AE';

export const createReportControlByPeriod = async (
  startDate?: string,
  endDate?: string,
) => {
  try {
    const sheetService = new ControlSheetService();
    const amo = new AmoAPI();

    // Инициализируем кэш пользователей
    await amo.initUsersCache();

    const { leads, pipelinesMap } = await getLeadsTodayOrByPeriod(
      startDate,
      endDate,
    );
    console.log(`📊 Найдено ${leads.length} сделок за период`);

    // Получаем существующие ID сделок
    const allRows = await sheetService.getRangeValues('A2:AE');
    const existingLeadIds = new Set<number>();
    for (const row of allRows) {
      const leadId = Number(row[0]);
      if (!isNaN(leadId) && leadId > 0) {
        existingLeadIds.add(leadId);
      }
    }

    // Собираем данные для новых сделок
    const googleSheetsData: (string | number)[][] = [];

    // Обрабатываем сделки пакетами
    await sheetService.processInBatches(
      leads,
      async (batch, batchIndex) => {
        const batchPromises = batch.map(async (lead) => {
          // Пропускаем существующие сделки
          if (existingLeadIds.has(lead.id)) return null;

          const fields = lead.custom_fields_values || [];
          const omTakenBy = getFieldValue(fields, 'ОМ Взято в работу');
          if (!omTakenBy) return null;

          // Получаем данные пользователя из кэша
          const createdAtFormatted = formatDate(lead.created_at);
          const [year, month, day] = getDate(lead.created_at);
          const leadPipeline = pipelinesMap[lead.pipeline_id];
          const statusLead = getStatusLead({
            statusId: lead.status_id,
            pipelineId: lead.pipeline_id,
          });

          return [
            lead.id, // A
            lead.name, // B
            `https://${DOMAIN}.amocrm.ru/leads/detail/${lead.id}`, // C
            createdAtFormatted, // D
            '', // E - Ответственный (оставляем пустым)
            '', // F
            '', // G
            '', // H
            '', // I
            '', // J
            '', // K
            '', // L
            '', // M
            '', // N
            day, // O
            month, // P
            year, // Q
            '', // R
            statusLead, // S Этап
            leadPipeline, // T Воронка
          ];
        });

        const batchResults = await Promise.all(batchPromises);
        const validResults = batchResults.filter((row) => row !== null) as (
          | string
          | number
        )[][];

        if (validResults.length > 0) {
          googleSheetsData.push(...validResults);
          console.log(
            `✅ Пакет ${batchIndex + 1}: добавлено ${validResults.length} строк`,
          );
        }
      },
      20, // batchSize
      1000, // delayBetweenBatches
    );

    // Записываем все новые строки пакетами
    if (googleSheetsData.length > 0) {
      console.log(
        `📦 Итоговый пакет для записи: ${googleSheetsData.length} строк`,
      );

      // Разбиваем на пакеты по 500 строк для надежности
      const MAX_ROWS_PER_BATCH = 500;

      for (let i = 0; i < googleSheetsData.length; i += MAX_ROWS_PER_BATCH) {
        const batch = googleSheetsData.slice(i, i + MAX_ROWS_PER_BATCH);
        const batchNumber = Math.floor(i / MAX_ROWS_PER_BATCH) + 1;
        const totalBatches = Math.ceil(
          googleSheetsData.length / MAX_ROWS_PER_BATCH,
        );

        console.log(
          `💾 Запись пакета ${batchNumber}/${totalBatches} (${batch.length} строк)`,
        );

        try {
          await sheetService.createGoogleFieldsBatch({ values: batch });
        } catch (error) {
          console.error(`❌ Ошибка записи пакета ${batchNumber}:`, error);
          // Пробуем записать меньшими пакетами
          const SMALL_BATCH = 100;
          for (let j = 0; j < batch.length; j += SMALL_BATCH) {
            const smallBatch = batch.slice(j, j + SMALL_BATCH);
            try {
              await sheetService.createGoogleFieldsBatch({
                values: smallBatch,
              });
              await new Promise((resolve) => setTimeout(resolve, 500));
            } catch (smallError) {
              console.error('❌ Ошибка записи малого пакета:', smallError);
            }
          }
        }

        // Задержка между пакетами записи
        if (i + MAX_ROWS_PER_BATCH < googleSheetsData.length) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      console.log(`✅ Создано ${googleSheetsData.length} базовых строк сделок`);
    } else {
      console.log('⏭️ Нет новых сделок для создания');
    }
  } catch (error) {
    console.error('❌ Ошибка создания:', error);
    throw error;
  }
};

export const updateReportControlDaily = async (): Promise<void> => {
  try {
    const sheetService = new ControlSheetService();
    const amo = new AmoAPI();

    const pipelinesResponse = await new AmoAPI().getAllPipelines();
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

    // Инициализируем кэш пользователей
    await amo.initUsersCache();

    // Получаем все строки таблицы
    const allRows = await sheetService.getRangeValues(`A2:${maxColumnName}`);
    console.log(`📊 Найдено ${allRows.length} строк в таблице`);

    // ГРУППИРУЕМ строки по ID сделки
    const leadsMap = new Map<
      number,
      Array<{
        row: (string | number)[];
        rowNumber: number;
        isBaseRow?: boolean;
      }>
    >();

    // Собираем ВСЕ существующие действия для сравнения
    const existingActions = new Set<string>();

    // ЗАПОЛНЯЕМ leadsMap ДАННЫМИ ИЗ allRows
    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i];
      const rowNumber = i + 2;
      const leadId = Number(row[0]);

      if (!leadId || isNaN(leadId)) {
        continue;
      }

      // Добавляем строку в группу по ID сделки
      if (!leadsMap.has(leadId)) {
        leadsMap.set(leadId, []);
      }

      // Определяем, является ли строка базовой (F, G, H пустые)
      const isBaseRow = !row[5] && !row[6] && !row[7];
      leadsMap.get(leadId)!.push({
        row,
        rowNumber,
        isBaseRow,
      });

      // Собираем ключи существующих действий
      const actionKey = createActionKey(row);
      if (actionKey) {
        existingActions.add(actionKey);
      }
    }

    console.log(
      `🎯 Обработка ${leadsMap.size} уникальных сделок (из ${allRows.length} строк)`,
    );

    // Массивы для пакетной обработки
    const updates: Array<{ range: string; values: any[][] }> = [];
    const newRows: (string | number)[][] = [];

    // Функция для задержки
    const delay = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    // Получаем список уникальных сделок
    const leadIds = Array.from(leadsMap.keys());

    // Обрабатываем УНИКАЛЬНЫЕ сделки
    for (let i = 0; i < leadIds.length; i++) {
      const leadId = leadIds[i];
      const leadRows = leadsMap.get(leadId)!;

      // Находим базовую строку сделки
      const baseRowInfo = leadRows.find((r) => r.isBaseRow) || leadRows[0];
      const baseRow = baseRowInfo.row;
      const baseRowNumber = baseRowInfo.rowNumber;

      if (!leadId || isNaN(leadId)) {
        console.log(`⏭️ Сделка ${leadId}: пропуск, некорректный ID`);
        continue;
      }

      console.log(
        `\n🔄 [${i + 1}/${leadIds.length}] Обработка сделки ${leadId} (${leadRows.length} строк)`,
      );

      try {
        // Задержка между запросами к amoCRM
        if (i > 0) {
          await delay(150);
        }

        // 1. ПОЛУЧИТЬ ТЕКУЩИЕ ДАННЫЕ СДЕЛКИ ИЗ AMO (только для ответственного)
        console.log(`   👤 Получение актуальных данных сделки...`);
        let currentResponsible = '';
        let currentLeadData: any = null;

        try {
          // Получаем актуальную информацию о сделке
          currentLeadData = await amo.getLeadById(leadId);
          if (currentLeadData && currentLeadData.responsible_user_id) {
            const user = await amo.getUser(currentLeadData.responsible_user_id);
            currentResponsible = user ? user.name : '';
            console.log(`   👤 Текущий ответственный: ${currentResponsible}`);
          }
        } catch (error) {
          if (error instanceof Error)
            console.log(
              `   ⚠️ Не удалось получить данные сделки: ${error.message}`,
            );
        }

        // 2. ОБНОВИТЬ ТОЛЬКО ОТВЕТСТВЕННОГО В БАЗОВОЙ СТРОКЕ
        if (currentResponsible && currentResponsible !== baseRow[4]) {
          console.log(
            `   ✏️ Обновление ответственного с "${baseRow[4]}" на "${currentResponsible}"`,
          );

          updates.push({
            range: `E${baseRowNumber}:E${baseRowNumber}`, // Только колонка E
            values: [[currentResponsible]],
          });

          // Обновляем локальную копию
          baseRow[4] = currentResponsible;
        }

        // Получаем timestamp для остальных запросов
        let createdAtTimestamp: number;
        try {
          const leadCreatedAt = baseRow[3];
          createdAtTimestamp = Math.floor(
            new Date(leadCreatedAt).getTime() / 1000,
          );
        } catch {
          createdAtTimestamp = Math.floor(Date.now() / 1000);
        }

        // 3. ПОЛУЧИТЬ ДАННЫЕ ДЛЯ НОВЫХ СТРОК
        let fromContact = null;
        let fromNotes = null;
        let tasks: Task[] = [];
        let leadStatusChanged: LeadStatusChangedEvent[] = [];
        let leadResponsibleChanged: LeadResponsibleChangedEvent[] = [];

        try {
          console.log(`   📞 Получение контактов...`);
          fromContact = await incomingActionDateFromContact(
            leadId,
            createdAtTimestamp,
          );
          await delay(100);

          console.log(`   📝 Получение примечаний...`);
          fromNotes = await incomingCallDate(leadId);
          await delay(100);

          console.log(`   ✅ Получение задач...`);
          tasks = await amo.getTasks(leadId);
          await delay(100);

          console.log(`   ✅ Получение статусов...`);
          leadStatusChanged = await amo.getStatusChanged(leadId);
          await delay(100);

          console.log(`   ✅ Получение ответственных...`);
          leadResponsibleChanged = await amo.getResponsibleChanged(leadId);
        } catch (error) {
          console.error(
            `   ⚠️ Ошибка получения данных для сделки ${leadId}:`,
            error,
          );
          continue;
        }

        const communications = [
          ...(fromContact?.communications || []),
          ...(fromNotes?.communications || []),
        ];
        const validTasks = tasks.filter((t) => t.result.text || t.text);

        if (
          !validTasks.length &&
          !communications.length &&
          !leadStatusChanged.length &&
          !leadResponsibleChanged.length
        ) {
          console.log(`   ⏭️ Нет новых действий для сделки ${leadId}`);
          continue;
        }

        console.log(
          `   📊 Найдено действий: ${communications.length} комм., ${validTasks.length} задач, ${leadStatusChanged.length} статусов, ${leadResponsibleChanged.length} ответственных`,
        );

        // 4. НАЙТИ ПЕРВОЕ ДЕЙСТВИЕ ДЛЯ ЗАПОЛНЕНИЯ БАЗОВОЙ СТРОКИ
        let firstActionRowData: (string | number)[] | null = null;
        let firstActionTime: number = Infinity;
        let firstActionSource = '';

        // Проверяем, пустая ли базовая строка (F, G, H пустые)
        const isBaseRowEmpty = !baseRow[5] && !baseRow[6] && !baseRow[7];

        // Если базовая строка не пустая, пропускаем заполнение
        if (!isBaseRowEmpty) {
          console.log(`   ⏭️ Базовая строка уже заполнена, пропускаем`);
        } else {
          console.log(
            `   🔍 Поиск первого действия для заполнения базовой строки...`,
          );

          // Ищем первое действие по времени среди всех типов

          // 4.1. Проверяем коммуникации
          for (const touch of communications) {
            if (touch.source === 'Звонок' && !touch.linkCall) {
              continue;
            }

            if (touch.time < firstActionTime) {
              firstActionTime = touch.time;
              const [y, mon, d, h, m, s] = getDate(touch.time);
              const responsible = await amo.getUser(touch.responsibleUserId);

              firstActionRowData = [
                leadId, // A
                baseRow[1] || '', // B
                baseRow[2] || '', // C
                baseRow[3] || '', // D
                baseRow[4] || '', // E (уже обновленный ответственный)
                touch.core || '', // F
                touch.source || '', // G
                touch.text || '', // H
                `${touch.source} ${touch.source === 'Письмо' || touch.source === 'Звонок' ? (touch.income ? 'вход' : 'исх') : ''}`, // I
                touch.source === 'Звонок'
                  ? touch.isDoCall
                    ? 'Да'
                    : 'Нет'
                  : '', // J
                touch.source === 'Звонок' && touch.isDoCall
                  ? formatTimeHHMMSS(touch.durationCall || 0)
                  : '', // K
                `${y}.${mon}.${d}`, // L
                `${h}:${m}:${s}`, // M
                '', // N
                baseRow[14] || '', // O
                baseRow[15] || '', // P
                baseRow[16] || '', // Q
                touch.linkCall || '', // R
                '', // S
                '', // T
                '', // U
                '', // V
                '', // W
                '', // X
                '', // Y
                '', // Z
                '', // AA
                '', // AB
                responsible ? responsible.name : '', // AC
              ];
              firstActionSource = touch.source;
            }
          }

          // 4.2. Проверяем задачи
          for (const task of validTasks) {
            if (task.created_at < firstActionTime) {
              firstActionTime = task.created_at;
              const [y, mon, d, h, m, s] = getDate(task.created_at);
              const responsible = await amo.getUser(task.responsible_user_id);

              firstActionRowData = [
                leadId, // A
                baseRow[1] || '', // B
                baseRow[2] || '', // C
                baseRow[3] || '', // D
                baseRow[4] || '', // E
                'task', // F
                'Задачи', // G
                task.text || '', // H
                'Встреча', // I
                task.is_completed ? 'Да' : 'Нет', // J
                '', // K
                `${y}.${mon}.${d}`, // L
                `${h}:${m}:${s}`, // M
                formatTimeHHMMSS(task.duration), // N
                baseRow[14] || '', // O
                baseRow[15] || '', // P
                baseRow[16] || '', // Q
                '', // R
                baseRow[18] || '', // S
                baseRow[19] || '', // T
                '', // U
                '', // V
                '', // W
                '', // X
                '', // Y
                '', // Z
                '', // AA
                '', // AB
                responsible ? responsible.name : '', // AC
              ];
              firstActionSource = 'Задача';
            }
          }

          // 4.3. Проверяем смены статусов
          for (const leadStatus of leadStatusChanged.sort(
            (a, b) => a.created_at - b.created_at,
          )) {
            if (leadStatus.created_at < firstActionTime) {
              firstActionTime = leadStatus.created_at;
              const [y, mon, d, h, m, s] = getDate(leadStatus.created_at);
              const leadBefore = leadStatus.value_before[0].lead_status;
              const leadAfter = leadStatus.value_after[0].lead_status;
              const responsible = await amo.getUser(leadStatus.created_by);

              const statusBefore = getStatusLead({
                statusId: leadBefore.id,
                pipelineId: leadBefore.pipeline_id,
              });
              const pipelineNameBefore =
                pipelinesMap[leadBefore.pipeline_id] || 'Не найдено';
              const statusAfter = getStatusLead({
                statusId: leadAfter.id,
                pipelineId: leadAfter.pipeline_id,
              });
              const pipelineNameAfter =
                pipelinesMap[leadAfter.pipeline_id] || 'Не найдено';

              firstActionRowData = [
                leadId, // A
                baseRow[1] || '', // B
                baseRow[2] || '', // C
                baseRow[3] || '', // D
                baseRow[4] || '', // E
                'event', // F
                'Этап/Воронка', // G
                '', // H
                '', // I
                '', // J
                '', // K
                ``, // L
                ``, // M
                '', // N
                baseRow[14] || '', // O
                baseRow[15] || '', // P
                baseRow[16] || '', // Q
                '', // R
                baseRow[18] || '', // S
                baseRow[19] || '', // T
                `${y}.${mon}.${d}`, // U
                `${h}:${m}:${s}`, // V
                pipelineNameBefore, // W
                statusBefore, // X
                pipelineNameAfter, // Y
                statusAfter, // Z
                '', // AA
                '', // AB
                responsible ? responsible.name : '', // AC
              ];
              firstActionSource = 'Этап/Воронка';
            }
          }

          // 4.4. Проверяем смены ответственного
          for (const lead of leadResponsibleChanged.sort(
            (a, b) => a.created_at - b.created_at,
          )) {
            if (lead.created_at < firstActionTime) {
              firstActionTime = lead.created_at;
              const [y, mon, d, h, m, s] = getDate(lead.created_at);
              let responsibleChanged = 'Робот';

              if (lead.created_by) {
                const user = await amo.getUser(lead.created_by);
                responsibleChanged = user ? user.name : '';
              }
              const leadBefore = lead.value_before[0].responsible_user;
              const leadAfter = lead.value_after[0].responsible_user;

              const responsibleBefore = await amo.getUser(leadBefore.id);
              const responsibleAfter = await amo.getUser(leadAfter.id);

              firstActionRowData = [
                leadId, // A
                baseRow[1] || '', // B
                baseRow[2] || '', // C
                baseRow[3] || '', // D
                baseRow[4] || '', // E
                'event', // F
                'Смена ответственного', // G
                '', // H
                '', // I
                '', // J
                '', // K
                ``, // L
                ``, // M
                '', // N
                baseRow[14] || '', // O
                baseRow[15] || '', // P
                baseRow[16] || '', // Q
                '', // R
                baseRow[18] || '', // S
                baseRow[19] || '', // T
                ``, // U
                ``, // V
                '', // W
                '', // X
                '', // Y
                '', // Z
                responsibleBefore ? responsibleBefore.name : '', // AA
                responsibleAfter ? responsibleAfter.name : '', // AB
                responsibleChanged, // AC
                `${y}.${mon}.${d}`, // AD
                `${h}:${m}:${s}`, // AE
              ];
              firstActionSource = 'Смена ответственного';
            }
          }

          // 5. ЗАПОЛНИТЬ БАЗОВУЮ СТРОКУ ПЕРВЫМ ДЕЙСТВИЕМ
          if (firstActionRowData) {
            console.log(
              `   ✅ Найдено первое действие: ${firstActionSource} от ${new Date(firstActionTime * 1000).toLocaleString()}`,
            );

            // Проверяем, что это действие еще не существует
            const actionKey = createActionKey(firstActionRowData);
            if (!existingActions.has(actionKey)) {
              // Обновляем базовую строку
              console.log(firstActionRowData, 'ЗДЕЕЕЕЕСЬ!!!');
              updates.push({
                range: `A${baseRowNumber}:AE${baseRowNumber}`,
                values: [firstActionRowData],
              });

              // Обновляем локальную копию
              for (let j = 0; j < firstActionRowData.length; j++) {
                baseRow[j] = firstActionRowData[j];
              }

              console.log(
                `   ✏️ Базовая строка заполнена первым действием (${firstActionSource})`,
              );

              // Добавляем ключ в существующие действия
              existingActions.add(actionKey);
            } else {
              console.log(`   ⚠️ Первое действие уже существует, пропускаем`);
            }
          } else {
            console.log(`   ⚠️ Не найдено подходящих действий для заполнения`);
          }
        }

        // 6. СОЗДАТЬ ОСТАЛЬНЫЕ НОВЫЕ СТРОКИ (кроме первого действия)
        const localNewRows: (string | number)[][] = [];

        // Обрабатываем коммуникации (кроме первого действия)
        for (const touch of communications) {
          if (
            touch.source === 'Звонок' &&
            (!touch.linkCall || touch.linkCall === '-')
          ) {
            continue;
          }

          // Пропускаем первое действие, если оно уже было использовано для заполнения базовой строки
          if (
            firstActionRowData &&
            touch.time === firstActionTime &&
            touch.source === firstActionSource
          ) {
            continue;
          }

          const [y, mon, d, h, m, s] = getDate(touch.time);
          const responsible = await amo.getUser(touch.responsibleUserId);

          const rowData = [
            leadId, // A
            baseRow[1] || '', // B
            baseRow[2] || '', // C
            baseRow[3] || '', // D
            baseRow[4] || '', // E
            touch.core || '', // F
            touch.source || '', // G
            touch.text || '', // H
            `${touch.source} ${touch.source === 'Письмо' || touch.source === 'Звонок' ? (touch.income ? 'вход' : 'исх') : ''}`, // I
            touch.source === 'Звонок' ? (touch.isDoCall ? 'Да' : 'Нет') : '', // J
            touch.source === 'Звонок' && touch.isDoCall
              ? formatTimeHHMMSS(touch.durationCall || 0)
              : '', // K
            `${y}.${mon}.${d}`, // L
            `${h}:${m}:${s}`, // M
            '', // N
            baseRow[14] || '', // O
            baseRow[15] || '', // P
            baseRow[16] || '', // Q
            touch.linkCall || '', // R
            '', // S
            '', // T
            '', // U
            '', // V
            '', // W
            '', // X
            '', // Y
            '', // Z
            '', // AA
            '', // AB
            responsible ? responsible.name : '', // AC
          ];

          const actionKey = createActionKey(rowData);
          if (actionKey && !existingActions.has(actionKey)) {
            localNewRows.push(rowData);
            existingActions.add(actionKey);
          }
        }

        // Обрабатываем задачи (кроме первого действия)
        for (const task of validTasks) {
          // Пропускаем первое действие
          if (
            firstActionRowData &&
            task.created_at === firstActionTime &&
            firstActionSource === 'Задача'
          ) {
            continue;
          }

          const [y, mon, d, h, m, s] = getDate(task.created_at);
          const responsible = await amo.getUser(task.responsible_user_id);

          const rowData = [
            leadId, // A
            baseRow[1] || '', // B
            baseRow[2] || '', // C
            baseRow[3] || '', // D
            baseRow[4] || '', // E
            'task', // F
            'Задачи', // G
            task.text || '', // H
            'Встреча', // I
            task.is_completed ? 'Да' : 'Нет', // J
            '', // K
            `${y}.${mon}.${d}`, // L
            `${h}:${m}:${s}`, // M
            formatTimeHHMMSS(task.duration), // N
            baseRow[14] || '', // O
            baseRow[15] || '', // P
            baseRow[16] || '', // Q
            '', // R
            baseRow[18] || '', // S
            baseRow[19] || '', // T
            '', // U
            '', // V
            '', // W
            '', // X
            '', // Y
            '', // Z
            '', // AA
            '', // AB
            responsible ? responsible.name : '', // AC
          ];

          const actionKey = createActionKey(rowData);
          if (actionKey && !existingActions.has(actionKey)) {
            localNewRows.push(rowData);
            existingActions.add(actionKey);
          }
        }

        // Обрабатываем воронки и этапы (кроме первого действия)
        for (const leadStatus of leadStatusChanged.sort(
          (a, b) => a.created_at - b.created_at,
        )) {
          // Пропускаем первое действие
          if (
            firstActionRowData &&
            leadStatus.created_at === firstActionTime &&
            firstActionSource === 'Этап/Воронка'
          ) {
            continue;
          }

          const [y, mon, d, h, m, s] = getDate(leadStatus.created_at);
          const leadBefore = leadStatus.value_before[0].lead_status;
          const leadAfter = leadStatus.value_after[0].lead_status;
          const responsible = await amo.getUser(leadStatus.created_by);

          const statusBefore = getStatusLead({
            statusId: leadBefore.id,
            pipelineId: leadBefore.pipeline_id,
          });
          const pipelineNameBefore =
            pipelinesMap[leadBefore.pipeline_id] || 'Не найдено';
          const statusAfter = getStatusLead({
            statusId: leadAfter.id,
            pipelineId: leadAfter.pipeline_id,
          });
          const pipelineNameAfter =
            pipelinesMap[leadAfter.pipeline_id] || 'Не найдено';

          const rowData = [
            leadId, // A
            baseRow[1] || '', // B
            baseRow[2] || '', // C
            baseRow[3] || '', // D
            baseRow[4] || '', // E
            'event', // F
            'Этап/Воронка', // G
            '', // H
            '', // I
            '', // J
            '', // K
            ``, // L
            ``, // M
            '', // N
            baseRow[14] || '', // O
            baseRow[15] || '', // P
            baseRow[16] || '', // Q
            '', // R
            baseRow[18] || '', // S
            baseRow[19] || '', // T
            `${y}.${mon}.${d}`, // U
            `${h}:${m}:${s}`, // V
            pipelineNameBefore, // W
            statusBefore, // X
            pipelineNameAfter, // Y
            statusAfter, // Z
            '', // AA
            '', // AB
            responsible ? responsible.name : '', // AC
          ];

          const actionKey = createActionKey(rowData);
          if (actionKey && !existingActions.has(actionKey)) {
            localNewRows.push(rowData);
            existingActions.add(actionKey);
          }
        }

        // Обрабатываем смену ответственного (кроме первого действия)
        for (const lead of leadResponsibleChanged.sort(
          (a, b) => a.created_at - b.created_at,
        )) {
          // Пропускаем первое действие
          if (
            firstActionRowData &&
            lead.created_at === firstActionTime &&
            firstActionSource === 'Смена ответственного'
          ) {
            continue;
          }

          const [y, mon, d, h, m, s] = getDate(lead.created_at);
          let responsibleChanged = 'Робот';

          if (lead.created_by) {
            const user = await amo.getUser(lead.created_by);
            responsibleChanged = user ? user.name : '';
          }
          const leadBefore = lead.value_before[0].responsible_user;
          const leadAfter = lead.value_after[0].responsible_user;

          const responsibleBefore = await amo.getUser(leadBefore.id);
          const responsibleAfter = await amo.getUser(leadAfter.id);

          const rowData = [
            leadId, // A
            baseRow[1] || '', // B
            baseRow[2] || '', // C
            baseRow[3] || '', // D
            baseRow[4] || '', // E
            'event', // F
            'Смена ответственного', // G
            '', // H
            '', // I
            '', // J
            '', // K
            ``, // L
            ``, // M
            '', // N
            baseRow[14] || '', // O
            baseRow[15] || '', // P
            baseRow[16] || '', // Q
            '', // R
            baseRow[18] || '', // S
            baseRow[19] || '', // T
            ``, // U
            ``, // V
            '', // W
            '', // X
            '', // Y
            '', // Z
            responsibleBefore ? responsibleBefore.name : '', // AA
            responsibleAfter ? responsibleAfter.name : '', // AB
            responsibleChanged, // AC
            `${y}.${mon}.${d}`, // AD
            `${h}:${m}:${s}`, // AE
          ];

          const actionKey = createActionKey(rowData);
          if (actionKey && !existingActions.has(actionKey)) {
            localNewRows.push(rowData);
            existingActions.add(actionKey);
          }
        }

        // 7. ДОБАВИТЬ ОСТАЛЬНЫЕ НОВЫЕ СТРОКИ
        if (localNewRows.length > 0) {
          newRows.push(...localNewRows);
          console.log(`   ➕ Добавлено ${localNewRows.length} новых действий`);
        }

        // Прогресс
        if ((i + 1) % 20 === 0) {
          console.log(
            `\n📊 Прогресс: ${i + 1}/${leadIds.length} сделок обработано`,
          );
          console.log(
            `   Собрано: ${updates.length} обновлений, ${newRows.length} новых строк`,
          );
          await delay(1000);
        }
      } catch (error) {
        console.error(`❌ Ошибка обработки сделки ${leadId}:`, error);
        await delay(500);
      }
    }

    // 7. ВЫПОЛНИТЬ ПАКЕТНЫЕ ОПЕРАЦИИ
    console.log(
      `\n📊 Итоги: ${updates.length} обновлений, ${newRows.length} новых строк`,
    );

    // Пакетное обновление существующих строк
    if (updates.length > 0) {
      console.log(`\n🔄 Выполнение ${updates.length} обновлений...`);

      const UPDATE_BATCH_SIZE = 30;
      for (let i = 0; i < updates.length; i += UPDATE_BATCH_SIZE) {
        const batch = updates.slice(i, i + UPDATE_BATCH_SIZE);
        const batchNumber = Math.floor(i / UPDATE_BATCH_SIZE) + 1;

        console.log(
          `   💾 Обновление пакета ${batchNumber} (${batch.length} строк)`,
        );

        try {
          await sheetService.batchUpdateCells(batch);
        } catch (error) {
          console.error(
            `   ❌ Ошибка обновления пакета ${batchNumber}:`,
            error,
          );
        }

        if (i + UPDATE_BATCH_SIZE < updates.length) {
          await delay(2000);
        }
      }
    }

    // Пакетное добавление новых строк
    if (newRows.length > 0) {
      console.log(`\n➕ Добавление ${newRows.length} новых строк...`);

      const CREATE_BATCH_SIZE = 100;
      for (let i = 0; i < newRows.length; i += CREATE_BATCH_SIZE) {
        const batch = newRows.slice(i, i + CREATE_BATCH_SIZE);
        const batchNumber = Math.floor(i / CREATE_BATCH_SIZE) + 1;

        console.log(
          `   💾 Запись пакета ${batchNumber} (${batch.length} строк)`,
        );

        try {
          await sheetService.createGoogleFieldsBatch({ values: batch });
        } catch (error) {
          console.error(`   ❌ Ошибка записи пакета ${batchNumber}:`, error);

          // Пробуем записать меньшими пакетами
          const SMALL_BATCH = 20;
          for (let j = 0; j < batch.length; j += SMALL_BATCH) {
            const smallBatch = batch.slice(j, j + SMALL_BATCH);
            try {
              await sheetService.createGoogleFieldsBatch({
                values: smallBatch,
              });
              await delay(500);
            } catch (smallError) {
              console.error('   ❌ Ошибка записи малого пакета:', smallError);
            }
          }
        }

        if (i + CREATE_BATCH_SIZE < newRows.length) {
          await delay(2000);
        }
      }
    }

    console.log(`\n✅ Обновление полей завершено`);
  } catch (error) {
    console.error('❌ Глобальная ошибка при обновлении полей:', error);
    throw error;
  }
};

// Функция для создания уникального ключа действия
function createActionKey(rowData: (string | number)[]): string {
  const leadId = rowData[0];
  const source = rowData[6]; // G

  // Для событий этапов/воронок
  if (source === 'Этап/Воронка') {
    const oldStatus = rowData[23]; // X
    const newStatus = rowData[25]; // Z
    const date = rowData[11] || rowData[20]; // L или U
    const time = rowData[12] || rowData[21]; // M или V
    return `stage_${leadId}_${oldStatus}_${newStatus}_${date}_${time}`;
  }

  // Для смены ответственного
  if (source === 'Смена ответственного') {
    const oldResp = rowData[30]; // AA
    const newResp = rowData[31]; // AB
    const date = rowData[33];
    const time = rowData[34];
    return `resp_${leadId}_${oldResp}_${newResp}_${date}_${time}`;
  }

  // Для обычных действий
  const text = rowData[7]; // H
  const date = rowData[11]; // L
  const time = rowData[12]; // M
  return `default_${leadId}_${source}_${text}_${date}_${time}`;
}
