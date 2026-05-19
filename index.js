const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const MONGODB_URI = 'mongodb://app_mama:oDcxd8NdKm1JiYK6@ac-f6nogqp-shard-00-00.yzfekxm.mongodb.net:27017,ac-f6nogqp-shard-00-01.yzfekxm.mongodb.net:27017,ac-f6nogqp-shard-00-02.yzfekxm.mongodb.net:27017/?ssl=true&replicaSet=atlas-gx3s4e-shard-0&authSource=admin&appName=appmama';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Conectado a MongoDB Atlas'))
  .catch((error) => console.error('Error al conectar a MongoDB:', error));

// ==========================================
// MODELOS
// ==========================================
const ventaSchema = new mongoose.Schema({
  fecha: { type: Date, default: Date.now },
  cantidadBidones: { type: Number, default: 0 },
  precioUnitario: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  metodoPago: { type: String, required: true },
  montoRecibido: { type: Number, default: 0 },
  vuelto: { type: Number, default: 0 },
  imagenTransferencia: { type: String },
  clienteNombre: { type: String },
  direccion: { type: String },
  // ===== NUEVO: estado de pago =====
  estadoPago: { type: String, default: 'Pagado', enum: ['Pagado', 'Pendiente'] },
  fechaPagado: { type: Date }
});
const Venta = mongoose.model('Venta', ventaSchema);

const clienteSchema = new mongoose.Schema({
  nombre: { type: String, required: true, unique: true },
  direccion: { type: String, default: '' },
  precioHabitual: { type: Number, default: 2500 },
  ultimaVenta: { type: Date, default: Date.now },
  totalVentas: { type: Number, default: 0 }
});
clienteSchema.index({ nombre: 'text' });
const Cliente = mongoose.model('Cliente', clienteSchema);

// ==========================================
// CORREO
// ==========================================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'cierredediaanavalenzuela@gmail.com',
    pass: 'hapqgvwcskaiokdf'
  }
});
const CORREO_DESTINO = 'cierredediaanavalenzuela@gmail.com';

// ==========================================
// HELPER: totales del día
// ==========================================
const calcularTotales = (ventas) => {
  let totalBidones = 0;
  let totalEfectivo = 0;
  let totalTransferencia = 0;
  let totalPendiente = 0;

  ventas.forEach(venta => {
    totalBidones += Number(venta.cantidadBidones) || 0;
    const monto = Number(venta.total) || 0;
    if (venta.metodoPago === 'Efectivo') totalEfectivo += monto;
    if (venta.metodoPago === 'Transferencia') totalTransferencia += monto;
    if (venta.estadoPago === 'Pendiente') totalPendiente += monto;
  });

  return { totalBidones, totalEfectivo, totalTransferencia, totalPendiente };
};

// ==========================================
// GUARDAR VENTA
// ==========================================
app.post('/api/ventas', async (req, res) => {
  try {
    const nuevaVenta = new Venta(req.body);
    const ventaGuardada = await nuevaVenta.save();

    if (req.body.clienteNombre && req.body.clienteNombre.trim()) {
      const nombreLimpio = req.body.clienteNombre.trim();
      await Cliente.findOneAndUpdate(
        { nombre: nombreLimpio },
        {
          $set: {
            direccion: req.body.direccion || '',
            precioHabitual: req.body.precioUnitario || 2500,
            ultimaVenta: new Date()
          },
          $inc: { totalVentas: 1 }
        },
        { upsert: true, new: true }
      );
    }

    console.log('Venta registrada:', ventaGuardada._id, '-', ventaGuardada.metodoPago, '-', ventaGuardada.estadoPago, '$' + ventaGuardada.total);
    res.status(201).json({ mensaje: 'Venta guardada con exito', venta: ventaGuardada });
  } catch (error) {
    console.error('Error al guardar la venta:', error);
    res.status(500).json({ error: 'Hubo un error al guardar la venta' });
  }
});

// ==========================================
// EDITAR VENTA
// ==========================================
app.put('/api/ventas/:id', async (req, res) => {
  try {
    const ventaActualizada = await Venta.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!ventaActualizada) return res.status(404).json({ error: 'Venta no encontrada' });

    if (req.body.clienteNombre && req.body.clienteNombre.trim()) {
      const nombreLimpio = req.body.clienteNombre.trim();
      await Cliente.findOneAndUpdate(
        { nombre: nombreLimpio },
        {
          $set: {
            direccion: req.body.direccion || '',
            precioHabitual: req.body.precioUnitario || 2500
          }
        },
        { upsert: true }
      );
    }

    res.json({ mensaje: 'Venta editada', venta: ventaActualizada });
  } catch (error) {
    console.error('Error al editar la venta:', error);
    res.status(500).json({ error: 'Error al editar la venta' });
  }
});

// ==========================================
// MARCAR COMO PAGADA (nueva ruta)
// ==========================================
app.put('/api/ventas/:id/pagar', async (req, res) => {
  try {
    const venta = await Venta.findByIdAndUpdate(
      req.params.id,
      {
        estadoPago: 'Pagado',
        fechaPagado: new Date(),
        // Si vienen datos adicionales (comprobante, método actualizado), los actualiza
        ...(req.body.imagenTransferencia && { imagenTransferencia: req.body.imagenTransferencia }),
        ...(req.body.metodoPago && { metodoPago: req.body.metodoPago })
      },
      { new: true }
    );
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });
    console.log('Venta marcada como pagada:', venta._id);
    res.json({ mensaje: 'Venta marcada como pagada', venta });
  } catch (error) {
    console.error('Error al marcar como pagada:', error);
    res.status(500).json({ error: 'Error al marcar como pagada' });
  }
});

// ==========================================
// BORRAR VENTA
// ==========================================
app.delete('/api/ventas/:id', async (req, res) => {
  try {
    const ventaBorrada = await Venta.findByIdAndDelete(req.params.id);
    if (!ventaBorrada) return res.status(404).json({ error: 'Venta no encontrada' });
    res.json({ mensaje: 'Venta borrada' });
  } catch (error) {
    console.error('Error al borrar la venta:', error);
    res.status(500).json({ error: 'Error al borrar la venta' });
  }
});

// ==========================================
// RESUMEN DEL DÍA
// ==========================================
app.get('/api/ventas/hoy', async (req, res) => {
  try {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const ventasHoy = await Venta.find({ fecha: { $gte: hoy } });
    const { totalBidones, totalEfectivo, totalTransferencia, totalPendiente } = calcularTotales(ventasHoy);
    res.json({
      cantidadVentas: ventasHoy.length,
      bidones: totalBidones,
      efectivo: totalEfectivo,
      transferencia: totalTransferencia,
      pendiente: totalPendiente,
      totalGeneral: totalEfectivo + totalTransferencia
    });
  } catch (error) {
    console.error('Error al obtener el cierre:', error);
    res.status(500).json({ error: 'Error al obtener el cierre del día' });
  }
});

// ==========================================
// LISTA DE VENTAS DEL DÍA
// ==========================================
app.get('/api/ventas/lista-hoy', async (req, res) => {
  try {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const ventasHoy = await Venta.find(
      { fecha: { $gte: hoy } },
      { imagenTransferencia: 0 }
    ).sort({ fecha: -1 });
    res.json(ventasHoy);
  } catch (error) {
    console.error('Error al listar ventas:', error);
    res.status(500).json({ error: 'Error al listar ventas del día' });
  }
});

// ==========================================
// LISTA DE PENDIENTES (de cualquier fecha)
// ==========================================
app.get('/api/ventas/pendientes', async (req, res) => {
  try {
    const pendientes = await Venta.find(
      { estadoPago: 'Pendiente' },
      { imagenTransferencia: 0 }
    ).sort({ fecha: -1 });
    res.json(pendientes);
  } catch (error) {
    console.error('Error al listar pendientes:', error);
    res.status(500).json({ error: 'Error al listar pendientes' });
  }
});

// ==========================================
// BUSCAR CLIENTES (autocompletado)
// ==========================================
app.get('/api/clientes/buscar', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 1) return res.json([]);
    const regex = new RegExp(q, 'i');
    const clientes = await Cliente.find({ nombre: regex })
      .sort({ ultimaVenta: -1 })
      .limit(8);
    res.json(clientes);
  } catch (error) {
    console.error('Error al buscar clientes:', error);
    res.status(500).json({ error: 'Error al buscar clientes' });
  }
});

app.get('/api/clientes', async (req, res) => {
  try {
    const clientes = await Cliente.find().sort({ ultimaVenta: -1 });
    res.json(clientes);
  } catch (error) {
    console.error('Error al listar clientes:', error);
    res.status(500).json({ error: 'Error al listar clientes' });
  }
});

// ==========================================
// GENERAR PDF Y ENVIAR AL CORREO
// ==========================================
app.get('/api/ventas/enviar-cierre', async (req, res) => {
  try {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const ventasHoy = await Venta.find({ fecha: { $gte: hoy } });
    const { totalBidones, totalEfectivo, totalTransferencia, totalPendiente } = calcularTotales(ventasHoy);

    const doc = new PDFDocument({ margin: 50 });
    let buffers = [];
    doc.on('data', buffers.push.bind(buffers));

    doc.on('end', async () => {
      const pdfData = Buffer.concat(buffers);
      const fechaTexto = new Date().toLocaleDateString('es-CL');
      try {
        await transporter.sendMail({
          from: '"App Agua Mama" <reportes@appmama.com>',
          to: CORREO_DESTINO,
          subject: `Cierre de Caja - ${fechaTexto}`,
          text: `Hola. Adjunto el reporte oficial en PDF con el balance del dia.`,
          attachments: [{
            filename: `Cierre_Caja_${fechaTexto.replace(/\//g, '-')}.pdf`,
            content: pdfData
          }]
        });
        res.json({ mensaje: 'Reporte enviado exitosamente' });
      } catch (mailError) {
        console.error('Error al enviar el email:', mailError);
        res.status(500).json({ error: 'Fallo el envio del correo.' });
      }
    });

    // ===== ENCABEZADO =====
    doc.fontSize(24).fillColor('#0284c7').text('Reporte de Ventas del Dia', { align: 'center' });
    doc.moveDown();
    doc.fontSize(14).fillColor('#333');
    doc.text(`Fecha del balance: ${new Date().toLocaleDateString('es-CL')}`);
    doc.text(`Cantidad de Entregas: ${ventasHoy.length}`);
    doc.text(`Total Bidones Vendidos: ${totalBidones}`);
    doc.text(`Recaudado en Efectivo: $${totalEfectivo.toLocaleString('es-CL')}`);
    doc.text(`Recaudado en Transferencias: $${totalTransferencia.toLocaleString('es-CL')}`);
    doc.moveDown();
    doc.fontSize(18).fillColor('#16a34a')
      .text(`TOTAL GENERAL CAJA: $${(totalEfectivo + totalTransferencia).toLocaleString('es-CL')}`);

    if (totalPendiente > 0) {
      doc.moveDown(0.5);
      doc.fontSize(14).fillColor('#dc2626')
        .text(`** Pendiente de cobro: $${totalPendiente.toLocaleString('es-CL')} **`);
    }
    doc.moveDown(2);

    // ===== HELPER PARA LISTAR VENTAS =====
    const listarVenta = (venta, index) => {
      const total = Number(venta.total) || 0;
      const esPendiente = venta.estadoPago === 'Pendiente';
      doc.fontSize(12).fillColor(esPendiente ? '#dc2626' : '#000');
      doc.text(`${index + 1}. ${esPendiente ? '[PENDIENTE] ' : ''}Direccion: ${venta.direccion || 'Sin direccion'}`);
      doc.fillColor('#444')
        .text(`   Cliente: ${venta.clienteNombre || 'N/A'} | Bidones: ${venta.cantidadBidones || 0} | Precio c/u: $${(venta.precioUnitario || 0).toLocaleString('es-CL')} | Total: $${total.toLocaleString('es-CL')}`);
    };

    // ===== EFECTIVO =====
    doc.fontSize(16).fillColor('#16a34a').text('Detalle Ventas en Efectivo:', { underline: true });
    doc.moveDown();
    const ventasEfectivo = ventasHoy.filter(v => v.metodoPago === 'Efectivo');
    if (ventasEfectivo.length === 0) {
      doc.fontSize(12).fillColor('#666').text('No se registraron ventas en efectivo hoy.');
    } else {
      ventasEfectivo.forEach((venta, index) => {
        listarVenta(venta, index);
        doc.moveDown(0.8);
      });
    }
    doc.moveDown(1.5);

    // ===== TRANSFERENCIAS =====
    doc.fontSize(16).fillColor('#0284c7').text('Detalle de Transferencias Cargadas:', { underline: true });
    doc.moveDown();
    const transferencias = ventasHoy.filter(v => v.metodoPago === 'Transferencia');
    if (transferencias.length === 0) {
      doc.fontSize(12).fillColor('#666').text('No se registraron ventas por transferencia hoy.');
    } else {
      transferencias.forEach((venta, index) => {
        listarVenta(venta, index);
        if (venta.imagenTransferencia) {
          try {
            const base64Data = venta.imagenTransferencia.replace(/^data:image\/\w+;base64,/, "");
            const imgBuffer = Buffer.from(base64Data, 'base64');
            doc.moveDown(0.5);
            doc.image(imgBuffer, { width: 180 });
          } catch (e) {
            doc.fillColor('red').text('   (No se pudo adjuntar la imagen)');
          }
        } else if (venta.estadoPago !== 'Pendiente') {
          doc.text('   (Sin comprobante adjunto)');
        }
        doc.moveDown(2);
      });
    }

    // ===== PENDIENTES =====
    const pendientes = ventasHoy.filter(v => v.estadoPago === 'Pendiente');
    if (pendientes.length > 0) {
      doc.moveDown(1);
      doc.fontSize(16).fillColor('#dc2626').text('VENTAS PENDIENTES DE PAGO:', { underline: true });
      doc.moveDown();
      pendientes.forEach((venta, index) => {
        listarVenta(venta, index);
        doc.moveDown(0.8);
      });
    }

    doc.end();
  } catch (error) {
    console.error('Error general en la ruta del PDF:', error);
    res.status(500).json({ error: 'Error interno del servidor al procesar el PDF.' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});