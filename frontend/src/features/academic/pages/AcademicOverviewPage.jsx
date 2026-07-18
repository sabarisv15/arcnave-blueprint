import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AcademicYearsPanel } from '@/features/academic/components/AcademicYearsPanel';
import { CurriculumPanel } from '@/features/academic/components/CurriculumPanel';
import { TimetablePeriodsPanel } from '@/features/academic/components/TimetablePeriodsPanel';
import { ClassesPanel } from '@/features/academic/components/ClassesPanel';

export function AcademicOverviewPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Academic</h1>
      <Tabs defaultValue="classes">
        <TabsList>
          <TabsTrigger value="classes">Classes</TabsTrigger>
          <TabsTrigger value="academic-years">Academic years</TabsTrigger>
          <TabsTrigger value="curriculum">Curriculum</TabsTrigger>
          <TabsTrigger value="timetable-periods">Timetable periods</TabsTrigger>
        </TabsList>
        <TabsContent value="classes"><ClassesPanel /></TabsContent>
        <TabsContent value="academic-years"><AcademicYearsPanel /></TabsContent>
        <TabsContent value="curriculum"><CurriculumPanel /></TabsContent>
        <TabsContent value="timetable-periods"><TimetablePeriodsPanel /></TabsContent>
      </Tabs>
    </div>
  );
}
