// ===================================================================
// CONTROL DE INGRESO CELUFIAMOS - SCRIPT COMPLETO
// Versión: 6.0 (Con correcciones de escritura y reporte histórico de novedades)
// ===================================================================

// --- CONFIGURACIÓN GLOBAL ---
const SPREADSHEET_ID = '1rpJmPJTBAwDDMDjkjS31eOiH6q0lEVjtOEgWAUsJ2W8';
const SHEET_EMPLOYEES = 'Empleados';
const SHEET_LOG = 'Registro';
const SHEET_SEDES = 'Sedes';
const FOLDER_ID_FOTOS = '1ebs6Xch0MXB8S-dxNFmhNXEXOhMuYYOr';
const SHEET_HISTORIAL_NOVEDADES = 'Historial de Novedades';
const EVENTOS_ESPERADOS = ['Ingreso', 'Salida Almuerzo', 'Regreso Almuerzo', 'Salida'];


// ===================================================================
// FUNCIONES DE LA APLICACIÓN WEB
// ===================================================================

/**
 * Función principal que se ejecuta al cargar la aplicación web.
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Control de Ingreso - Celufiamos')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Obtiene la lista de nombres de sedes desde la hoja 'Sedes'.
 * @returns {Array<string>} Una lista con los nombres de las sedes.
 */
function getSedesList() {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_SEDES);
    if (!sheet) return [];
    const sedesData = sheet.getRange("A2:A" + sheet.getLastRow()).getValues();
    const sedesList = sedesData.filter(row => row[0] !== "").map(row => row[0]);
    return sedesList;
  } catch (e) {
    Logger.log('Error en getSedesList: ' + e.toString());
    return [];
  }
}

/**
 * Busca los datos de un empleado por su número de documento.
 * @param {string} docId - El número de documento del empleado.
 * @returns {object} Un objeto con los datos del empleado o un objeto de error.
 */
function getEmployeeData(docId) {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_EMPLOYEES);
    if (!sheet) return { error: 'Error interno: La hoja "Empleados" no fue encontrada.' };

    const data = sheet.getDataRange().getValues();
    const cleanDocId = String(docId).trim();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() == cleanDocId) {
        return {
          documento: data[i][0],
          nombre: data[i][1],
          cargo: data[i][2],
          sedeAsignada: data[i][3]
        };
      }
    }
    return { error: 'Documento no encontrado. Verifique el número e intente de nuevo.' };
  } catch (e) {
    Logger.log('Error en getEmployeeData: ' + e.toString());
    return { error: 'Error en el servidor al buscar empleado: ' + e.message };
  }
}

/**
 * Registra una acción, previene duplicados y escribe en la fila correcta.
 * @param {object} logData - Datos del registro (docId, nombre, lat, long, etc.).
 * @returns {object} Objeto con el estado de la operación.
 */
function recordLog(logData) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const logSheet = ss.getSheetByName(SHEET_LOG);
    if (!logSheet) throw new Error(`La hoja '${SHEET_LOG}' no fue encontrada.`);
    
    // --- VALIDACIÓN DE DUPLICADOS ---
    const timezone = ss.getSpreadsheetTimeZone();
    const hoy = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
    const registrosExistentes = logSheet.getDataRange().getValues();
    for (let i = 1; i < registrosExistentes.length; i++) {
      const registro = registrosExistentes[i];
      const fechaRegistro = Utilities.formatDate(new Date(registro[0]), timezone, 'yyyy-MM-dd');
      const docIdRegistro = String(registro[1]).trim();
      const tipoEventoRegistro = String(registro[3]).trim();

      if (fechaRegistro === hoy && docIdRegistro === String(logData.docId).trim() && tipoEventoRegistro === String(logData.eventType).trim()) {
        const mensaje = "Ya has registrado este evento ('" + logData.eventType + "') el día de hoy.";
        return { status: "warning", message: mensaje };
      }
    }

    // --- PROCESO DE REGISTRO ---
    let geofenceStatus = "Sede no encontrada o sin coordenadas";
    let sedeLat, sedeLon, sedeRadius;
    const nombreSedeSeleccionada = logData.selectedSede;
    
    if (nombreSedeSeleccionada) {
      const sedesSheet = ss.getSheetByName(SHEET_SEDES);
      if (sedesSheet) {
        const sedesData = sedesSheet.getDataRange().getValues();
        const sedeRow = sedesData.find(row => String(row[0]).trim().toUpperCase() === String(nombreSedeSeleccionada).trim().toUpperCase());
        if (sedeRow) {
          const coordsText = sedeRow[1]; // Asumiendo Coordenadas en Col B
          const radius = sedeRow[2]; // Asumiendo Radio en Col C
          if (coordsText && radius) {
            const coords = String(coordsText).split(',');
            if (coords.length === 2) {
              sedeLat = parseFloat(coords[0].trim());
              sedeLon = parseFloat(coords[1].trim());
              sedeRadius = parseFloat(radius);
              const distanciaEnMetros = calculateDistance(logData.latitude, logData.longitude, sedeLat, sedeLon);
              geofenceStatus = distanciaEnMetros <= sedeRadius ? `Dentro de la sede (${Math.round(distanciaEnMetros)}m)` : `Fuera de la sede (${Math.round(distanciaEnMetros)}m)`;
            }
          }
        }
      }
    }

    let fotoUrl = "No";
    if (logData.imageData) {
      const fileName = `${logData.docId}-${logData.eventType}-${new Date().getTime()}`;
      fotoUrl = saveImageToDrive(logData.imageData, fileName);
    }

    const newRow = [new Date(), logData.docId, logData.nombre, logData.eventType, logData.latitude, logData.longitude, geofenceStatus, fotoUrl, nombreSedeSeleccionada];
    
    // --- ESCRITURA CORRECTA EN LA ÚLTIMA FILA ---
    const lastRow = logSheet.getLastRow();
    logSheet.getRange(lastRow + 1, 1, 1, newRow.length).setValues([newRow]);
    
    const responseData = { status: "success", geofenceStatus: geofenceStatus, message: "Registro guardado.", employeeCoords: { lat: logData.latitude, lng: logData.longitude }, sedeCoords: null, sedeRadius: null };
    if (sedeLat && sedeLon && sedeRadius) {
      responseData.sedeCoords = { lat: sedeLat, lng: sedeLon };
      responseData.sedeRadius = sedeRadius;
    }
    return responseData;

  } catch (error) {
    Logger.log("Error en recordLog: " + error.toString());
    return { status: "error", message: "No se pudo guardar el registro: " + error.message };
  }
}

/**
 * Guarda una imagen (en formato base64) en una carpeta de Google Drive.
 */
function saveImageToDrive(data, fileName) {
  try {
    const imageBlob = Utilities.newBlob(Utilities.base64Decode(data.split(',')[1]), 'image/jpeg', fileName + '.jpg');
    const folder = DriveApp.getFolderById(FOLDER_ID_FOTOS);
    const file = folder.createFile(imageBlob);
    return file.getUrl();
  } catch (e) {
    Logger.log('Error al guardar imagen en Drive: ' + e.toString());
    return "Error al guardar foto";
  }
}

/**
 * Calcula la distancia entre dos puntos geográficos.
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}


// ===================================================================
// FUNCIONES DE REPORTE Y CONTROL (CORREGIDAS)
// ===================================================================

/**
 * Crea un menú personalizado en la UI de la hoja de cálculo.
 */
function onOpen() {
  SpreadsheetApp.getUi()
      .createMenu('CELUFIAMOS - Reportes')
      .addItem('Registrar Novedades de Ayer', 'registrarNovedadesDeAyer')
      .addToUi();
}

/**
 * Identifica ausencias y marcaciones incompletas de ayer y las añade a una tabla histórica.
 */
function registrarNovedadesDeAyer() {
  const ui = SpreadsheetApp.getUi();
  try {
    const confirm = ui.alert('Confirmar Acción', 'Se buscarán las novedades de ayer y se añadirán al historial. ¿Desea continuar?', ui.ButtonSet.OK_CANCEL);
    if (confirm !== ui.Button.OK) {
      ui.alert('Operación cancelada.');
      return;
    }

    // Ya no necesitamos definir 'ss' aquí para pasarlo, pero lo mantenemos para otras operaciones
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const timezone = ss.getSpreadsheetTimeZone();
    
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    const fechaAyerStr = Utilities.formatDate(ayer, timezone, 'yyyy-MM-dd');

    const empleadosSheet = ss.getSheetByName(SHEET_EMPLOYEES);
    if (!empleadosSheet) throw new Error(`La hoja "${SHEET_EMPLOYEES}" no fue encontrada.`);
    const todosLosEmpleadosData = empleadosSheet.getDataRange().getValues().slice(1);
    const mapaTodosLosEmpleados = new Map(todosLosEmpleadosData.map(row => [String(row[0]).trim(), { nombre: row[1].trim(), cargo: row[2].trim() }]));

    const logSheet = ss.getSheetByName(SHEET_LOG);
    if (!logSheet) throw new Error(`La hoja "${SHEET_LOG}" no fue encontrada.`);
    const registrosData = logSheet.getDataRange().getValues();
    const marcacionesPorEmpleado = new Map();

    for (let i = 1; i < registrosData.length; i++) {
      const registro = registrosData[i];
      if (Utilities.formatDate(new Date(registro[0]), timezone, 'yyyy-MM-dd') === fechaAyerStr) {
        const docId = String(registro[1]).trim();
        const evento = String(registro[3]).trim();
        if (!marcacionesPorEmpleado.has(docId)) {
          marcacionesPorEmpleado.set(docId, new Set());
        }
        marcacionesPorEmpleado.get(docId).add(evento);
      }
    }

    const novedadesDelDia = [];
    const fechaNovedad = new Date(fechaAyerStr);

    for (const [docId, empleadoInfo] of mapaTodosLosEmpleados.entries()) {
      if (!marcacionesPorEmpleado.has(docId)) {
        novedadesDelDia.push([fechaNovedad, docId, empleadoInfo.nombre, empleadoInfo.cargo, 'Ausencia', 'No registró ninguna marcación']);
      } else {
        const eventosMarcados = marcacionesPorEmpleado.get(docId);
        const eventosFaltantes = EVENTOS_ESPERADOS.filter(evento => !eventosMarcados.has(evento));
        if (eventosFaltantes.length > 0) {
          novedadesDelDia.push([fechaNovedad, docId, empleadoInfo.nombre, empleadoInfo.cargo, 'Incompleto', `Faltó: ${eventosFaltantes.join(', ')}`]);
        }
      }
    }

    if (novedadesDelDia.length > 0) {
      // LLAMADA CORREGIDA: Ya no se pasa 'ss'
      escribirNovedadesEnHistorial(novedadesDelDia);
      ui.alert('¡Novedades Registradas!', `Se han añadido ${novedadesDelDia.length} novedades de ayer a la hoja "${SHEET_HISTORIAL_NOVEDADES}".`, ui.ButtonSet.OK);
    } else {
      ui.alert('¡Sin Novedades!', `No se encontraron ausencias ni marcaciones incompletas para el día de ayer.`, ui.ButtonSet.OK);
    }

  } catch (e) {
    Logger.log('Error en registrarNovedadesDeAyer: ' + e.toString());
    ui.alert('Error', 'Ocurrió un error al registrar las novedades: ' + e.message, ui.ButtonSet.OK);
  }
}

/**
 * Añade las novedades a la hoja de historial. (VERSIÓN CORREGIDA Y A PRUEBA DE ERRORES)
 * @param {Array<Array<any>>} novedades - Array 2D con las filas de novedades a añadir.
 */
function escribirNovedadesEnHistorial(novedades) {
  // ===================== INICIO DE LA CORRECCIÓN =====================
  // Cláusula de guarda: Si la función es llamada sin novedades o con un array vacío,
  // simplemente se detiene para evitar el error.
  if (!novedades || novedades.length === 0) {
    Logger.log("Se intentó llamar a escribirNovedadesEnHistorial sin datos. La operación se ha detenido.");
    return; // Detiene la ejecución de esta función aquí mismo.
  }
  // ====================== FIN DE LA CORRECCIÓN =======================

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let historialSheet = ss.getSheetByName(SHEET_HISTORIAL_NOVEDADES);
  
  if (!historialSheet) {
    historialSheet = ss.insertSheet(SHEET_HISTORIAL_NOVEDADES);
    const cabeceras = [['Fecha Novedad', 'Documento', 'Nombre', 'Cargo', 'Tipo de Novedad', 'Detalle']];
    historialSheet.getRange(1, 1, 1, 6).setValues(cabeceras).setFontWeight('bold');
    historialSheet.setFrozenRows(1);
  }
  
  const ultimaFila = historialSheet.getLastRow();
  
  // Esta línea ahora es segura porque la cláusula de guarda de arriba
  // asegura que 'novedades' siempre tendrá al menos un elemento.
  historialSheet.getRange(ultimaFila + 1, 1, novedades.length, novedades[0].length).setValues(novedades);
  
  historialSheet.autoResizeColumns(1, 6);
  ss.setActiveSheet(historialSheet);
}
// ===================================================================
// FUNCIÓN DE SINCRONIZACIÓN
// ===================================================================

function sincronizarEmpleados() {
  const ID_HOJA_ORIGEN = '136ibX1JGQ8YYLtGlK9T9KT2ZobDiZ1BsDefpoqxO31o';
  const NOMBRE_HOJA_ORIGEN = 'data';
  const ssDestino = SpreadsheetApp.openById(SPREADSHEET_ID);
  const hojaDestino = ssDestino.getSheetByName(SHEET_EMPLOYEES);

  try {
    const ssOrigen = SpreadsheetApp.openById(ID_HOJA_ORIGEN);
    const hojaOrigen = ssOrigen.getSheetByName(NOMBRE_HOJA_ORIGEN);
    if (!hojaOrigen) throw new Error(`No se encontró la hoja de origen '${NOMBRE_HOJA_ORIGEN}'`);
    
    const datosOrigen = hojaOrigen.getDataRange().getValues();
    const datosLimpios = [['Documento', 'Nombre', 'Cargo', 'Sede']];

    for (let i = 1; i < datosOrigen.length; i++) {
      const fila = datosOrigen[i];
      const actualizacion = String(fila[1]).trim().toUpperCase();
      const documento = String(fila[3]).trim();
      const nombre = String(fila[5]).trim().toUpperCase();
      const cargo = String(fila[6]).trim().toUpperCase();
      const sede = String(fila[7]).trim().toUpperCase();

      if (actualizacion.includes('ACTUALIZACI') && documento && nombre !== 'UPPER EIPER' && cargo !== 'UPPER EIPER' && sede !== 'UPPER EIPER') {
        datosLimpios.push([documento, nombre, cargo, sede]);
      }
    }

    hojaDestino.clearContents();
    if (datosLimpios.length > 1) {
      hojaDestino.getRange(1, 1, datosLimpios.length, datosLimpios[0].length).setValues(datosLimpios);
    }
    SpreadsheetApp.flush();
    Logger.log('Sincronización de empleados completada.');

  } catch (e) {
    Logger.log('Error en la sincronización de empleados: ' + e.toString());
  }
}
