from django.contrib import admin
from django.urls import path,re_path
from core import views
urlpatterns=[path('',views.home),path('admin/',admin.site.urls),path('dashboard/',views.dashboard),path('participar/',views.public_page),path('participar/cadastro/',views.public_page,{'page':'join.html'}),path('participar/avaliar/',views.public_page,{'page':'review.html'}),path('public/<path:name>',views.public_asset),path('static/<path:name>',views.dashboard_asset),path('api/v2/<path:path>',views.api),path('api/navigation',views.legacy_navigation),path('api/routes',views.legacy_navigation),path('<path:name>',views.legacy_file)]
