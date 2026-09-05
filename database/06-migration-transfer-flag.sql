-- ============================================================
-- Migration 06: Tandai Transaksi Transfer Antar Dompet
-- Jalankan SETELAH migration 01-05 di Supabase SQL Editor
-- ============================================================
--
-- Masalah yang diperbaiki: transfer antar dompet (misal BCA -> Cash)
-- sebelumnya dicatat sebagai "pengeluaran" di dompet asal dan
-- "pemasukan" di dompet tujuan. Ini benar untuk SALDO PER DOMPET,
-- tapi salah untuk STATISTIK (Ringkasan, Grafik, Skor Kesehatan,
-- Proyeksi) karena transfer BUKAN aktivitas pemasukan/pengeluaran
-- riil — cuma pemindahan uang antar kantong sendiri.
--
-- Kolom is_transfer menandai transaksi mana yang berasal dari fitur
-- transfer, supaya bisa di-exclude dari perhitungan statistik tanpa
-- mengganggu perhitungan saldo per dompet (yang tetap perlu transaksi
-- pengeluaran+pemasukan ini untuk akurat).

ALTER TABLE transaksi
  ADD COLUMN IF NOT EXISTS is_transfer BOOLEAN NOT NULL DEFAULT false;
