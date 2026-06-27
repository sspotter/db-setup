import psycopg2

HOST = "100.115.149.3"      # Change if needed
PORT = 5432
DATABASE = "Tik_Surfer_multi_fix"
USER = "devuser"
PASSWORD = "&Pf56ngsrkk"   # real password; %26 in the .env URL is just URL-encoding for &

try:
    conn = psycopg2.connect(
        host=HOST,
        port=PORT,
        database=DATABASE,
        user=USER,
        password=PASSWORD,
        connect_timeout=5,
    )

    print("✅ Connected successfully!")

    cur = conn.cursor()
    cur.execute("SELECT version();")
    version = cur.fetchone()

    print("PostgreSQL version:")
    print(version[0])

    cur.close()
    conn.close()

except Exception as e:
    print("❌ Connection failed")
    print(e)