#define _GNU_SOURCE
#include <sys/resource.h>
#include <sys/ptrace.h>
#include <sys/uio.h>
#include <sched.h>
#include <signal.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
#include <errno.h>
int main(void) {
 int stop,kill_result,nice_result,schedule,trace,memory,vm;
 errno=0; stop=kill(1,SIGSTOP); int stop_errno=errno;
 errno=0; kill_result=kill(1,SIGKILL); int kill_errno=errno;
 errno=0; nice_result=setpriority(PRIO_PROCESS,1,19); int nice_errno=errno;
 struct sched_param param={0}; errno=0; schedule=sched_setscheduler(1,SCHED_IDLE,&param); int schedule_errno=errno;
 errno=0; trace=ptrace(PTRACE_ATTACH,1,0,0); int trace_errno=errno;
 errno=0; memory=open("/proc/1/mem",O_RDWR); int memory_errno=errno; if(memory>=0)close(memory);
 char value=0;struct iovec local={&value,1},remote={(void*)1,1};errno=0;vm=process_vm_writev(1,&local,1,&remote,1,0);int vm_errno=errno;
 printf("{\"uid\":%d,\"stop\":[%d,%d],\"kill\":[%d,%d],\"renice\":[%d,%d],\"scheduler\":[%d,%d],\"ptrace\":[%d,%d],\"procMem\":[%d,%d],\"processVm\":[%d,%d]}\n",getuid(),stop,stop_errno,kill_result,kill_errno,nice_result,nice_errno,schedule,schedule_errno,trace,trace_errno,memory,memory_errno,vm,vm_errno);
 return getuid()==10001&&stop<0&&kill_result<0&&nice_result<0&&schedule<0&&trace<0&&memory<0&&vm<0?0:1;
}
