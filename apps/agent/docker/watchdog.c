#define _GNU_SOURCE
#include <sys/timerfd.h>
#include <sys/wait.h>
#include <signal.h>
#include <unistd.h>
#include <stdint.h>
#include <stdlib.h>
#include <errno.h>
#include <time.h>
// PID namespace init, immutable read-only ELF. No child-provided commands or IPC.
static void reap(int sig) { (void)sig; while (waitpid(-1, 0, WNOHANG) > 0) {} }
int main(void) {
  if (getpid() != 1 || getuid() != 10002 || getgid() != 10002) return 125;
  const char *value = getenv("ATOMS_JOB_DEADLINE_AT"); char *end = 0;
  if (!value || !*value) return 125;
  errno = 0; long long deadline = strtoll(value, &end, 10);
  if (errno || !end || *end || deadline <= 0) return 125;
  struct timespec wall, boot;
  if (clock_gettime(CLOCK_REALTIME, &wall) || clock_gettime(CLOCK_BOOTTIME, &boot)) return 125;
  long long remaining = deadline - ((long long)wall.tv_sec * 1000 + wall.tv_nsec / 1000000);
  if (remaining <= 0) return 124;
  if (remaining > 180000) return 125;
  struct itimerspec timer = {0};
  timer.it_value.tv_sec = boot.tv_sec + remaining / 1000;
  timer.it_value.tv_nsec = boot.tv_nsec + (remaining % 1000) * 1000000;
  if (timer.it_value.tv_nsec >= 1000000000) { timer.it_value.tv_sec++; timer.it_value.tv_nsec -= 1000000000; }
  int fd = timerfd_create(CLOCK_BOOTTIME, TFD_CLOEXEC);
  if (fd < 0 || timerfd_settime(fd, TFD_TIMER_ABSTIME, &timer, 0)) return 125;
  struct sigaction action = {0}; action.sa_handler = reap; sigemptyset(&action.sa_mask);
  if (sigaction(SIGCHLD, &action, 0)) return 125;
  uint64_t expirations;
  for (;;) { ssize_t n = read(fd, &expirations, sizeof expirations); if (n == sizeof expirations) _exit(124); if (n < 0 && errno == EINTR) continue; _exit(125); }
}
