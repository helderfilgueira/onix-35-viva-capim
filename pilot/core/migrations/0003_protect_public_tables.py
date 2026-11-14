"""Django owns access; Supabase browser/Data API roles cannot reach pilot tables.

Intentionally scoped to exact Django/core table names in public. No schemas,
default privileges, unrelated tables, views or Supabase auth/storage are changed.
Rollback keeps the protection instead of reopening personal information.
"""
from django.db import migrations


def protect_public_tables(apps,schema_editor):
    connection=schema_editor.connection
    if connection.vendor!='postgresql':return
    labels={'admin','auth','contenttypes','sessions','core'}
    names={m._meta.db_table for m in apps.get_models(include_auto_created=True) if m._meta.app_label in labels and m._meta.managed}
    names.add('django_migrations')
    quote=connection.ops.quote_name
    with connection.cursor() as cursor:
        cursor.execute("SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')")
        roles=[quote(row[0]) for row in cursor.fetchall()]
        grantees=', '.join(['PUBLIC',*roles])
        cursor.execute("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')")
        existing={row[0] for row in cursor.fetchall()}
        for name in sorted(names & existing):
            table=f'{quote("public")}.{quote(name)}'
            cursor.execute(f'ALTER TABLE {table} ENABLE ROW LEVEL SECURITY')
            cursor.execute(f'REVOKE ALL PRIVILEGES ON TABLE {table} FROM {grantees}')
        # No permissive policies: only the owner/server DB role operates these tables.
        # Do not FORCE RLS, because the owner is the trusted Django server connection.


class Migration(migrations.Migration):
    dependencies=[('core','0002_ratebucket_updated_at'),('admin','0003_logentry_add_action_flag_choices'),('auth','0012_alter_user_first_name_max_length'),('contenttypes','0002_remove_content_type_name'),('sessions','0001_initial')]
    operations=[migrations.RunPython(protect_public_tables,migrations.RunPython.noop)]
