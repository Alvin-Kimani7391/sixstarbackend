const mongoose = require('mongoose');
const { Schema } = mongoose;

// Generic atomic counter collection. One document per named sequence.
// _id is the sequence name (e.g. "orderNumber"); seq is the last value issued.
const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 99 }, // first $inc gives 100
});

module.exports = mongoose.model('Counter', counterSchema);