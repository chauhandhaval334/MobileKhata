# MobileKhata - Database Backup & Restore Guide

Agar kabhi database corrupt ho jaye, data accidentally delete ho jaye, ya aapko database kisi naye server par restore karna ho, toh is guide ko follow karein.

---

## Step 1: Backup File Download Karein

Aap backup file do tareeqo se download kar sakte hain:

### Method A: Admin Panel Se (Recommended)
1. MobileKhata Admin Panel (`/admin`) me login karein.
2. Sidebar se **Database Backups** tab me jayein.
3. Jis date ka backup chahiye, uske aage **Download** button par click karein.
4. `.sql.gz` file aapke system par download ho jayegi.

### Method B: Firebase Console Se
1. [Firebase Console](https://console.firebase.google.com/) par jayein aur apna project select karein.
2. Left menu se **Storage** par click karein.
3. **`backups`** folder ke andar jayein.
4. Apni tarikh (date) ke hisab se backup file select karein aur **Download** par click karein.

---

## Step 2: Database ko Clean/Reset Karein (Important)
Naye data ko restore karne se pehle puraane corrupt/incomplete data ko hatana zaroori hai taaki "Duplicate Key" ya "Table Already Exists" ke errors na aayein.

1. Apne Neon.tech console me **SQL Editor** open karein (ya pgAdmin/DBeaver me database se connect karein).
2. Niche di gayi SQL queries run karke public schema ko reset karein:
   ```sql
   DROP SCHEMA public CASCADE;
   CREATE SCHEMA public;
   GRANT ALL ON SCHEMA public TO public;
   ```
   *Note: Isse database bilkul khali (clean) ho jayega aur restore ke liye tayyar ho jayega.*

---

## Step 3: Backup Restore Karein

Aap apne terminal ya command prompt se direct database restore kar sakte hain.

### Method A: Git Bash / Linux / macOS (One-liner)
Agar aapke paas Git Bash ya Linux terminal hai, toh aap bina file ko unzip kiye direct restore kar sakte hain:

```bash
# Apne download folder me terminal open karein aur ye run karein:
gunzip -c backup-YYYY-MM-DD-HHMMSS.sql.gz | psql "YOUR_NEON_DATABASE_URL"
```
*(Replace `backup-YYYY-MM-DD-HHMMSS.sql.gz` with your downloaded file name and `YOUR_NEON_DATABASE_URL` with your Neon DB connection string).*

---

### Method B: Windows Command Prompt (CMD) / PowerShell
Agar aap standard CMD ya PowerShell use kar rahe hain:

1. Pehle `.sql.gz` file ko **extract (unzip)** karein (7-Zip ya WinRAR ka use karke). Aapko ek simple `.sql` file milegi (jaise `backup-xxxx.sql`).
2. CMD/PowerShell open karein aur download folder me ja kar ye command chalayein:
   ```cmd
   psql "YOUR_NEON_DATABASE_URL" -f backup-xxxx.sql
   ```

---

## Step 4: DBeaver / pgAdmin (GUI Tool) Se Restore Karna
Agar aap cmd use nahi karna chahte aur DBeaver/pgAdmin use karte hain:

1. `.sql.gz` file ko pehle unzip karke `.sql` file bana lein.
2. DBeaver me apne Neon DB connection par **Right Click** karein.
3. **Tools** -> **Execute Script** (ya Restore) select karein.
4. Downloaded `.sql` file select karein aur **Start** par click kar dein.

---

## Kuch Common Errors aur Solution

* **Error: `psql: command not found`**
  * **Symptom:** Windows ko psql command nahi mil rahi hai.
  * **Solution:** Aapke system par PostgreSQL installed hona chahiye aur uska path Windows Environment Variables me set hona chahiye.
  * **Workaround:** Aap directly Neon.tech ke dashboard me SQL Editor me ja kar extracted `.sql` file ka content copy-paste karke bhi run kar sakte hain (agar database ka size chota hai).

* **Error: `relation already exists`**
  * **Solution:** Puraane tables delete nahi kiye gaye hain. Step 2 (Reset Database) ko fir se karein aur phir restore run karein.
