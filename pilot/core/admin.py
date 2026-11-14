from django.contrib import admin
from .models import Organization, StaffProfile, Event, Content, Benefit, Member, Review, Redemption, Ledger, Audit

class ReadOnlyDomainAdmin(admin.ModelAdmin):
    """Domain changes go through audited APIs, never bypass ledger/approval invariants."""
    def has_add_permission(self,request):return False
    def has_change_permission(self,request,obj=None):return False
    def has_delete_permission(self,request,obj=None):return False
    def has_view_permission(self,request,obj=None):return request.user.is_superuser
    list_per_page=50

@admin.register(Member)
class MemberAdmin(ReadOnlyDomainAdmin):
    list_display=['id','status','balance','created_at']
    exclude=['phone','first_name','last_name']

@admin.register(Review)
class ReviewAdmin(ReadOnlyDomainAdmin):
    list_display=['id','target_type','target_id','score','created_at']
    exclude=['member']

for model in (Organization,StaffProfile,Event,Content,Benefit,Redemption,Ledger,Audit):admin.site.register(model,ReadOnlyDomainAdmin)
admin.site.site_header='Viva Capim · supervisão técnica'
