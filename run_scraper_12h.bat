@echo off
title LeadBase 12-Hour Automated Scraper Daemon
echo ======================================================================
echo Starting LeadBase 12-Hour Automated Scraper Daemon...
echo Will run every 12 hours automatically and upsert leads to Supabase.
echo ======================================================================
cd /d "%~dp0"
python -u python_scraper\auto_scraper_12h.py --interval 12
pause
